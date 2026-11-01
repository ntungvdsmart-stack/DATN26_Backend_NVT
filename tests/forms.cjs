const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async ({ page, origin, api, screenshots }) => {
    const cases = [
        ['/admin/accounts', 'Tạo tài khoản'], ['/admin/branches', 'Thêm Chi nhánh'],
        ['/admin/categories', 'Thêm Danh mục'], ['/admin/promotions', 'Tạo mã mới'],
        ['/admin/faqs', 'Thêm FAQ'], ['/products', 'Nhập sản phẩm mới']
    ];
    const audit = async label => {
        const layer = page.locator('.modal-layer').last();
        await layer.waitFor();
        const results = await layer.evaluate(root => {
            const failures = [];
            if (root.parentElement !== document.body) failures.push('Modal is not portaled to body');
            if (document.body.style.overflow !== 'hidden') failures.push('Background scroll is not locked');
            for (const field of root.querySelectorAll('input,select,textarea,button')) {
                if (field.disabled || ['hidden','checkbox','radio','file','color'].includes(field.type) || !field.getClientRects().length) continue;
                field.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
                const rect = field.getBoundingClientRect();
                if (rect.width < 1 || rect.height < 1) continue;
                const name = field.name || field.placeholder || field.textContent?.trim().slice(0,35) || field.tagName;
                if (rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1) failures.push(`${name}: outside viewport ${JSON.stringify({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })}`);
                const hit = document.elementFromPoint(Math.max(0, Math.min(innerWidth-1, rect.x + rect.width/2)), Math.max(0, Math.min(innerHeight-1, rect.y + rect.height/2)));
                if (hit !== field && !field.contains(hit)) failures.push(`${name}: covered by ${hit?.tagName}.${hit?.className}`);
                if (field.tagName === 'SELECT' && rect.height < 40) failures.push(`${name}: select touch target too short`);
            }
            return failures;
        });
        assert.deepEqual(results, [], label);
        return layer;
    };
    for (const width of [320,375,768,1440]) {
        await page.setViewportSize({ width, height: width < 768 ? 568 : 900 });
        for (const [route, button] of cases) {
            await page.goto(origin + route);
            await page.getByRole('button', { name: button, exact: true }).click();
            const layer = await audit(`${route} ${width}px`);
            const select = layer.locator('select').first();
            if (await select.count()) {
                await select.evaluate(element => { element.add(new Option('Một lựa chọn rất dài để kiểm tra kích thước và chống tràn '.repeat(4), 'layout-test-only')); element.value = 'layout-test-only'; });
                await audit(`long select ${route} ${width}px`);
            }
            await page.keyboard.press('Escape');
            await layer.waitFor({ state: 'hidden' });
        }
        console.log(`PASS forms: six admin forms, control hit testing, scrolling and long options at ${width}px`);
    }

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(origin + '/products');
    await page.getByRole('button', { name: 'Nhập sản phẩm mới', exact: true }).click();
    const product = page.getByRole('dialog', { name: 'Sản phẩm', exact: true });
    await product.getByRole('button', { name: 'Mới', exact: true }).first().click();
    const quick = page.getByRole('dialog', { name: 'Thêm thuộc tính', exact: true });
    await audit('Nested quick-create modal');
    await quick.getByRole('textbox', { name: 'Tên thuộc tính' }).fill('   ');
    await quick.getByRole('button', { name: 'Lưu', exact: true }).click();
    assert.equal(await quick.getByRole('textbox', { name: 'Tên thuộc tính' }).evaluate(element => element.validity.valid), false);
    await page.keyboard.press('Tab');
    assert.equal(await quick.evaluate(root => root.contains(document.activeElement)), true, 'Focus escapes nested modal');
    await page.screenshot({ path: path.join(screenshots, 'nested-form-mobile.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await quick.waitFor({ state: 'hidden' });
    await product.waitFor();
    assert.equal(await product.evaluate(root => root.contains(document.activeElement)), true, 'Focus not restored to product form');
    await page.keyboard.press('Escape');

    const suggestionRoute = `${api}/vietmap/autocomplete*`;
    const handler = route => route.fulfill({ json: { success: true, data: [{ ref_id: 'layout-place', name: 'Địa chỉ có nội dung dài', display: 'Một địa chỉ rất dài để kiểm tra xuống dòng và chọn bằng bàn phím '.repeat(3) }] } });
    await page.route(suggestionRoute, handler);
    await page.goto(origin + '/admin/branches');
    await page.getByRole('button', { name: 'Thêm Chi nhánh', exact: true }).click();
    const branch = page.getByRole('dialog', { name: 'Chi nhánh', exact: true });
    await branch.getByRole('combobox', { name: 'Địa chỉ đầy đủ' }).fill('Test address');
    const list = page.getByRole('listbox', { name: 'Gợi ý địa chỉ' });
    await list.waitFor();
    const bounds = await list.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 376 && bounds.y >= 0 && bounds.y + bounds.height <= 668, 'Address list clips outside viewport');
    await page.keyboard.press('Escape');
    await list.waitFor({ state: 'hidden' });
    await branch.waitFor();
    await page.keyboard.press('Escape');
    await branch.waitFor({ state: 'hidden' });
    await page.unroute(suggestionRoute, handler);
    await page.goto(origin + '/admin/accounts');
    await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
    const account = page.getByRole('dialog', { name: 'Tài khoản', exact: true });
    const phone = account.locator('input[name="phone"]');
    await phone.fill('+84901234567');
    assert.equal(await phone.evaluate(element => element.checkValidity()), true, '+84 phone should be valid');
    await phone.fill('123');
    assert.equal(await phone.evaluate(element => element.checkValidity()), false, 'Short phone should be rejected');
    await page.keyboard.press('Escape');
    await page.goto(origin + '/admin/promotions');
    await page.getByRole('button', { name: 'Tạo mã mới', exact: true }).click();
    const promo = page.getByRole('dialog', { name: 'Khuyến mãi', exact: true });
    await promo.locator('input[type="text"]').nth(0).fill('FORM-TEST');
    await promo.locator('input[type="text"]').nth(1).fill('Kiểm tra thời gian');
    await promo.locator('input[type="number"]').first().fill('101');
    assert.equal(await promo.locator('input[type="number"]').first().evaluate(element => element.checkValidity()), false, 'Percent over 100 accepted');
    await promo.locator('input[type="number"]').first().fill('10');
    await promo.locator('input[type="datetime-local"]').nth(0).fill('2026-10-19T12:00');
    await promo.locator('input[type="datetime-local"]').nth(1).fill('2026-10-19T11:00');
    await promo.getByRole('button', { name: 'Lưu Khuyến Mãi', exact: true }).click();
    await promo.getByRole('alert').waitFor();
    assert.match(await promo.getByRole('alert').textContent(), /kết thúc/);
    await page.keyboard.press('Escape');
    await page.goto(origin + '/admin/categories');
    const parentRow = page.getByRole('row').filter({ has: page.locator('td:nth-child(2)').getByText('Test category', { exact: true }) });
    await parentRow.getByRole('button').first().click();
    let categoryForm = page.getByRole('dialog', { name: 'Danh mục và thuộc tính', exact: true });
    assert.equal(await categoryForm.getByRole('option', { name: 'Fixture child', exact: true }).count(), 0, 'Descendant category offered as parent');
    await page.keyboard.press('Escape');
    const childRow = page.getByRole('row').filter({ has: page.locator('td:nth-child(2)').getByText('Fixture child', { exact: true }) });
    await childRow.getByRole('button').first().click();
    categoryForm = page.getByRole('dialog', { name: 'Danh mục và thuộc tính', exact: true });
    assert.equal(await categoryForm.locator('select').inputValue(), '1', 'Edit form lost category parent');
    await page.keyboard.press('Escape');
    console.log('PASS forms: nested focus, whitespace validation and unclipped address suggestions');
};
