-- SCHEMA SOURCE ONLY: do not import this file. Use DoAnMo/fashion_database.sql or npm run db:migrate.
-- ============================================================================
-- CƠ SỞ DỮ LIỆU: HỆ THỐNG BÁN HÀNG THỜI TRANG ĐA KÊNH (Online + POS)
-- Chuẩn hóa: BCNF (Boyce-Codd Normal Form)
-- MySQL 8.0+
-- Phiên bản: 2.0 — Đã sửa các vi phạm chuẩn hóa
-- ============================================================================
-- DANH SÁCH THAY ĐỔI SO VỚI v1.0:
--   [FIX-1] activity_logs: account_id NOT NULL → NULL, thêm customer_id để log cả 2 loại user
--   [FIX-2] notifications: Tách polymorphic FK (recipient_type + recipient_id)
--           thành 2 cột có FK thực sự: customer_id + account_id
--   [FIX-3] customer_reviews: Thêm FOREIGN KEY còn thiếu cho order_id
--   [FIX-4] orders: Thêm 3 INDEX quan trọng bị thiếu (customer_id, created_at, branch_id)
--           Thêm bảng customer_addresses, thay shipping_address VARCHAR bằng FK + snapshot
--   [FIX-5] promotions: Thêm 3 trường kiểm soát sử dụng (min_order_amount,
--           max_usage_count, max_per_customer)
--   [FIX-6] categories: Thêm UNIQUE KEY theo cấp (parent_id, category_name)
--   [FIX-7] product_variants: Thêm generated column variant_key để xử lý NULL UNIQUE trap
-- ============================================================================



-- ============================================================================
-- MODULE 8: QUẢN TRỊ HỆ THỐNG (Branches, Accounts, Roles, Logs)
-- Đặt trước vì nhiều bảng khác tham chiếu tới branch_id / account_id
-- ============================================================================

CREATE TABLE branches (
    latitude DECIMAL(10,7) NULL,
    longitude DECIMAL(10,7) NULL,
    branch_id       INT AUTO_INCREMENT PRIMARY KEY,
    branch_name     VARCHAR(150) NOT NULL,
    address         VARCHAR(255),
    phone           VARCHAR(20),
    is_active       TINYINT(1) NOT NULL DEFAULT 1,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE roles (
    role_id         INT AUTO_INCREMENT PRIMARY KEY,
    role_name       VARCHAR(50) NOT NULL UNIQUE COMMENT 'Admin, Staff; khách hàng lưu riêng trong customers'
) ENGINE=InnoDB;

CREATE TABLE permissions (
    permission_id   INT AUTO_INCREMENT PRIMARY KEY,
    permission_code VARCHAR(100) NOT NULL UNIQUE,
    description     VARCHAR(255)
) ENGINE=InnoDB;

-- Quan hệ N-N giữa role và permission (chuẩn hóa, tránh lặp permission trong role)
CREATE TABLE role_permissions (
    role_id         INT NOT NULL,
    permission_id   INT NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(permission_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE accounts (
    auth_version INT NOT NULL DEFAULT 0,
    account_id      INT AUTO_INCREMENT PRIMARY KEY,
    username        VARCHAR(50) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    full_name       VARCHAR(150) NOT NULL,
    email           VARCHAR(150) UNIQUE,
    phone           VARCHAR(20),
    role_id         INT NOT NULL,
    branch_id       INT NULL COMMENT 'NULL nếu là Admin không thuộc chi nhánh nào',
    is_active       TINYINT(1) NOT NULL DEFAULT 1,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (role_id) REFERENCES roles(role_id),
    FOREIGN KEY (branch_id) REFERENCES branches(branch_id)
) ENGINE=InnoDB;

-- [FIX-1] activity_logs:
--   Trước: account_id INT NOT NULL → chỉ log được staff/admin, không log được customer
--   Sau:   account_id NULL + customer_id NULL
--   NOTE: MySQL Error 3823 — không thể dùng CHECK constraint trên cột có FK với
--         ON DELETE SET NULL. Thay thế bằng TRIGGER bên dưới để đảm bảo
--         ít nhất 1 trong 2 (account_id / customer_id) phải có giá trị.
CREATE TABLE activity_logs (
    log_id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    account_id      INT NULL    COMMENT 'NULL nếu hành động do khách hàng thực hiện',
    customer_id     INT NULL    COMMENT 'NULL nếu hành động do staff/admin thực hiện',
    action          VARCHAR(100) NOT NULL COMMENT 'CREATE_ORDER, UPDATE_PRODUCT, LOGIN...',
    target_table    VARCHAR(100),
    target_id       BIGINT,
    description     VARCHAR(500),
    ip_address      VARCHAR(45),
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id)  REFERENCES accounts(account_id)  ON DELETE SET NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Trigger thay thế CHECK constraint (do giới hạn MySQL 3823)
-- Đảm bảo mỗi log luôn có chủ thể: account_id hoặc customer_id phải có giá trị
DELIMITER $$
CREATE TRIGGER trg_activity_logs_before_insert
BEFORE INSERT ON activity_logs
FOR EACH ROW
BEGIN
    IF NEW.account_id IS NULL AND NEW.customer_id IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'activity_logs: account_id và customer_id không thể đồng thời NULL';
    END IF;
END$$

CREATE TRIGGER trg_activity_logs_before_update
BEFORE UPDATE ON activity_logs
FOR EACH ROW
BEGIN
    IF NEW.account_id IS NULL AND NEW.customer_id IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'activity_logs: account_id và customer_id không thể đồng thời NULL';
    END IF;
END$$
DELIMITER ;

-- ============================================================================
-- MODULE 1: QUẢN LÝ SẢN PHẨM
-- Tồn kho theo biến thể (size + màu + chất liệu) dùng chung Online & POS
-- ============================================================================

-- [FIX-6] categories: Thêm UNIQUE KEY (parent_id, category_name) để tránh
--   trùng tên trong cùng 1 cấp danh mục. UNIQUE cho phép nhiều NULL (root categories).
CREATE TABLE categories (
    category_id     INT AUTO_INCREMENT PRIMARY KEY,
    category_name   VARCHAR(100) NOT NULL,
    image_url       VARCHAR(1000) NULL,
    is_featured     TINYINT(1) NOT NULL DEFAULT 0,
    display_order   INT NOT NULL DEFAULT 0,
    parent_id       INT NULL COMMENT 'Danh mục cha, cho phép phân cấp',
    sort_order      INT NOT NULL DEFAULT 0 COMMENT 'Thứ tự hiển thị trong cùng cấp',
    FOREIGN KEY (parent_id) REFERENCES categories(category_id),
    UNIQUE KEY uq_category_per_parent (parent_id, category_name)
) ENGINE=InnoDB;

CREATE TABLE brands (
    brand_id        INT AUTO_INCREMENT PRIMARY KEY,
    brand_name      VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE sizes (
    size_id         INT AUTO_INCREMENT PRIMARY KEY,
    size_value      VARCHAR(20) NOT NULL UNIQUE COMMENT 'S, M, L, XL, 38, 39...'
) ENGINE=InnoDB;

CREATE TABLE colors (
    color_id        INT AUTO_INCREMENT PRIMARY KEY,
    color_name      VARCHAR(50) NOT NULL UNIQUE,
    hex_code        VARCHAR(7)
) ENGINE=InnoDB;

CREATE TABLE materials (
    material_id     INT AUTO_INCREMENT PRIMARY KEY,
    material_name   VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE products (
    size_guide_image_url VARCHAR(500) NULL,
    product_id      INT AUTO_INCREMENT PRIMARY KEY,
    product_name    VARCHAR(200) NOT NULL,
    description     TEXT,
    category_id     INT NOT NULL,
    brand_id        INT NULL,
    base_price      DECIMAL(12,2) NOT NULL DEFAULT 0,
    is_active       TINYINT(1) NOT NULL DEFAULT 1,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(category_id),
    FOREIGN KEY (brand_id) REFERENCES brands(brand_id),
    FULLTEXT KEY ft_product_name (product_name)
) ENGINE=InnoDB;

-- [FIX-7] product_variants: Xử lý NULL UNIQUE trap
--   Vấn đề: UNIQUE KEY(product_id, size_id, color_id, material_id) trong MySQL
--   không ngăn 2 row có cùng thuộc tính đều NULL → tạo duplicate variant
--   Nguyên nhân lỗi 1215: Generated STORED column dùng FK columns → MySQL từ chối
--   Giải pháp: Giữ UNIQUE KEY gốc + BEFORE INSERT/UPDATE trigger kiểm tra manual
CREATE TABLE product_variants (
    size_description TEXT NULL,
    variant_id      INT AUTO_INCREMENT PRIMARY KEY,
    product_id      INT NOT NULL,
    sku             VARCHAR(50) NOT NULL UNIQUE,
    size_id         INT NULL,
    color_id        INT NULL,
    material_id     INT NULL,
    price           DECIMAL(12,2) NOT NULL COMMENT 'Có thể khác base_price theo biến thể',
    is_active       TINYINT(1) NOT NULL DEFAULT 1,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
    FOREIGN KEY (size_id)    REFERENCES sizes(size_id),
    FOREIGN KEY (color_id)   REFERENCES colors(color_id),
    FOREIGN KEY (material_id) REFERENCES materials(material_id),
    -- UNIQUE KEY cơ bản (không bắt được NULL duplicate — xử lý bằng trigger bên dưới)
    UNIQUE KEY uq_variant (product_id, size_id, color_id, material_id)
) ENGINE=InnoDB;

-- Trigger thay thế generated column UNIQUE để bắt NULL UNIQUE trap
-- Logic: COALESCE NULL → 0 trước khi so sánh → không bao giờ có 2 variant giống nhau
DELIMITER $$
CREATE TRIGGER trg_variants_before_insert
BEFORE INSERT ON product_variants
FOR EACH ROW
BEGIN
    DECLARE dup_count INT DEFAULT 0;
    SELECT COUNT(*) INTO dup_count
    FROM product_variants
    WHERE product_id  = NEW.product_id
      AND COALESCE(size_id,     0) = COALESCE(NEW.size_id,     0)
      AND COALESCE(color_id,    0) = COALESCE(NEW.color_id,    0)
      AND COALESCE(material_id, 0) = COALESCE(NEW.material_id, 0);

    IF dup_count > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'product_variants: Đã tồn tại biến thể với tổ hợp size/màu/chất liệu này';
    END IF;
END$$

CREATE TRIGGER trg_variants_before_update
BEFORE UPDATE ON product_variants
FOR EACH ROW
BEGIN
    DECLARE dup_count INT DEFAULT 0;
    SELECT COUNT(*) INTO dup_count
    FROM product_variants
    WHERE product_id  = NEW.product_id
      AND COALESCE(size_id,     0) = COALESCE(NEW.size_id,     0)
      AND COALESCE(color_id,    0) = COALESCE(NEW.color_id,    0)
      AND COALESCE(material_id, 0) = COALESCE(NEW.material_id, 0)
      AND variant_id != NEW.variant_id;  -- Bỏ qua chính nó khi UPDATE

    IF dup_count > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'product_variants: Đã tồn tại biến thể với tổ hợp size/màu/chất liệu này';
    END IF;
END$$
DELIMITER ;

-- Ảnh sản phẩm: thuộc về product, có thể gắn thêm với variant (VD: ảnh theo màu)
-- Nhiều ảnh / 1 sản phẩm, 1 ảnh đánh dấu is_primary = 1
CREATE TABLE product_images (
    image_id        INT AUTO_INCREMENT PRIMARY KEY,
    product_id      INT NOT NULL,
    variant_id      INT NULL COMMENT 'Ảnh riêng theo màu sắc variant (nếu có)',
    image_url       VARCHAR(500) NOT NULL,
    is_primary      TINYINT(1) NOT NULL DEFAULT 0,
    sort_order      INT NOT NULL DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES product_variants(variant_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Tồn kho theo biến thể VÀ theo chi nhánh (dùng chung cho Online & POS)
CREATE TABLE inventory (
    inventory_id    INT AUTO_INCREMENT PRIMARY KEY,
    variant_id      INT NOT NULL,
    branch_id       INT NOT NULL COMMENT 'Kho trung tâm coi như 1 branch đặc biệt',
    quantity        INT NOT NULL DEFAULT 0,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (variant_id) REFERENCES product_variants(variant_id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(branch_id),
    UNIQUE KEY uq_inventory (variant_id, branch_id)
) ENGINE=InnoDB;

-- ============================================================================
-- MODULE 7: QUẢN LÝ KHÁCH HÀNG (đăng ký online + khách vãng lai tại quầy)
-- ============================================================================

CREATE TABLE customers (
    auth_version INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    loyalty_points INT NOT NULL DEFAULT 0,
    customer_id     INT AUTO_INCREMENT PRIMARY KEY,
    full_name       VARCHAR(150) NOT NULL,
    phone           VARCHAR(20) UNIQUE,
    email           VARCHAR(150) UNIQUE,
    password_hash   VARCHAR(255) NULL COMMENT 'NULL nếu là khách vãng lai (guest)',
    customer_type   ENUM('online','guest') NOT NULL DEFAULT 'guest',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- [FIX-4] Tách địa chỉ khách hàng ra bảng riêng:
--   Trước: address VARCHAR(255) trong customers → không thể lọc theo tỉnh/thành phố,
--          không tái dùng địa chỉ giữa các đơn hàng.
--   Sau:   Bảng customer_addresses với city/district/ward để phân tích địa lý.
--          orders giữ snapshot địa chỉ lúc đặt hàng để tránh thay đổi ngược thời gian.
CREATE TABLE customer_addresses (
    latitude DECIMAL(10,7) NULL,
    longitude DECIMAL(10,7) NULL,
    address_id      INT AUTO_INCREMENT PRIMARY KEY,
    customer_id     INT NOT NULL,
    recipient_name  VARCHAR(150) NOT NULL COMMENT 'Tên người nhận (có thể khác tên KH)',
    recipient_phone VARCHAR(20)  NOT NULL,
    full_address    VARCHAR(255) NOT NULL COMMENT 'Số nhà, tên đường',
    ward            VARCHAR(100),
    district        VARCHAR(100),
    city            VARCHAR(100),
    is_default      TINYINT(1) NOT NULL DEFAULT 0,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- [FIX-3] customer_reviews: Thêm FK còn thiếu cho order_id
--   Trước: order_id BIGINT NULL không có FOREIGN KEY → có thể lưu order_id không tồn tại
--   Sau:   Thêm FK với ON DELETE SET NULL (review vẫn còn dù đơn bị xóa)
CREATE TABLE customer_reviews (
    review_id       INT AUTO_INCREMENT PRIMARY KEY,
    customer_id     INT NOT NULL,
    variant_id      INT NOT NULL,
    order_id        BIGINT NULL COMMENT 'NULL nếu không xác định được đơn hàng',
    rating          TINYINT NOT NULL COMMENT '1-5',
    comment         TEXT,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
    FOREIGN KEY (variant_id)  REFERENCES product_variants(variant_id),
    FOREIGN KEY (order_id)    REFERENCES orders(order_id) ON DELETE SET NULL,
    CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB;

-- ============================================================================
-- MODULE 2 & 3: GIỎ HÀNG / WISHLIST (Online) - không áp dụng cho POS
-- ============================================================================

CREATE TABLE carts (
    cart_id         INT AUTO_INCREMENT PRIMARY KEY,
    customer_id     INT NOT NULL UNIQUE COMMENT 'Mỗi khách chỉ có 1 giỏ hàng active',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE cart_items (
    cart_item_id    INT AUTO_INCREMENT PRIMARY KEY,
    cart_id         INT NOT NULL,
    variant_id      INT NOT NULL,
    quantity        INT NOT NULL DEFAULT 1,
    added_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cart_id)    REFERENCES carts(cart_id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES product_variants(variant_id),
    UNIQUE KEY uq_cart_variant (cart_id, variant_id)
) ENGINE=InnoDB;

CREATE TABLE wishlists (
    wishlist_id     INT AUTO_INCREMENT PRIMARY KEY,
    customer_id     INT NOT NULL,
    variant_id      INT NOT NULL,
    added_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id)  REFERENCES product_variants(variant_id),
    UNIQUE KEY uq_wishlist (customer_id, variant_id)
) ENGINE=InnoDB;

-- ============================================================================
-- KHUYẾN MÃI / VOUCHER (dùng chung Online + POS)
-- ============================================================================

-- [FIX-5] promotions: Thêm 3 trường kiểm soát sử dụng voucher
--   Trước: Không có giới hạn sử dụng → phải xử lý toàn bộ ở tầng application
--   Sau:   min_order_amount, max_usage_count, max_per_customer để DB hỗ trợ validate
CREATE TABLE promotions (
    promotion_id        INT AUTO_INCREMENT PRIMARY KEY,
    promo_code          VARCHAR(50) NOT NULL UNIQUE,
    promo_name          VARCHAR(150) NOT NULL,
    discount_type       ENUM('percent','amount') NOT NULL,
    discount_value      DECIMAL(12,2) NOT NULL,
    channel_scope       ENUM('online','pos','both') NOT NULL DEFAULT 'both',
    min_order_amount    DECIMAL(12,2) NOT NULL DEFAULT 0    COMMENT 'Giá trị đơn hàng tối thiểu để áp dụng',
    max_usage_count     INT NULL                            COMMENT 'NULL = không giới hạn tổng số lần dùng',
    max_per_customer    INT NOT NULL DEFAULT 1              COMMENT 'Mỗi khách dùng tối đa N lần',
    start_date          DATETIME NOT NULL,
    end_date            DATETIME NOT NULL,
    is_active           TINYINT(1) NOT NULL DEFAULT 1,
    CHECK (end_date > start_date)
) ENGINE=InnoDB;

-- ============================================================================
-- MODULE 2, 3, 4: ĐƠN HÀNG (dùng chung Online & POS qua trường "channel")
-- ============================================================================

-- [FIX-4] orders:
--   Trước: shipping_address VARCHAR(255) → không thể phân tích địa lý, không tái dùng
--   Sau:   shipping_address_id FK → customer_addresses (tham chiếu bản ghi địa chỉ)
--          + shipping_address_snapshot VARCHAR → lưu snapshot text lúc đặt để tránh
--            thay đổi ngược thời gian khi khách sửa địa chỉ sau này
CREATE TABLE orders (
    loyalty_discount DECIMAL(12,2) NOT NULL DEFAULT 0,
    shipping_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
    shipping_latitude DECIMAL(10,7) NULL,
    shipping_longitude DECIMAL(10,7) NULL,
    note VARCHAR(500) NULL,
    points_earned INT NOT NULL DEFAULT 0,
    order_id                BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_code              VARCHAR(30) NOT NULL UNIQUE,
    channel                 ENUM('online','pos') NOT NULL,
    customer_id             INT NULL    COMMENT 'NULL nếu khách vãng lai không lưu tài khoản',
    branch_id               INT NULL    COMMENT 'Bắt buộc nếu channel = pos',
    staff_id                INT NULL    COMMENT 'NV bán tại quầy, NULL nếu đơn online tự đặt',
    order_status            ENUM('pending','confirmed','processing','shipping',
                                 'completed','cancelled','returned') NOT NULL DEFAULT 'pending',
    subtotal_amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount_amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_amount            DECIMAL(12,2) NOT NULL DEFAULT 0,
    -- Địa chỉ giao hàng: FK để tham chiếu + snapshot để bảo toàn lịch sử
    shipping_address_id     INT NULL    COMMENT 'FK tới customer_addresses (có thể NULL với POS)',
    shipping_address_snapshot VARCHAR(500) NULL COMMENT 'Snapshot địa chỉ lúc đặt hàng, không thay đổi theo thời gian',
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id)          REFERENCES customers(customer_id),
    FOREIGN KEY (branch_id)            REFERENCES branches(branch_id),
    FOREIGN KEY (staff_id)             REFERENCES accounts(account_id),
    FOREIGN KEY (shipping_address_id)  REFERENCES customer_addresses(address_id) ON DELETE SET NULL,
    -- [FIX-4] Các INDEX bị thiếu
    INDEX idx_order_channel_status (channel, order_status),
    INDEX idx_orders_customer      (customer_id),
    INDEX idx_orders_created       (created_at),
    INDEX idx_orders_branch        (branch_id)
) ENGINE=InnoDB;

CREATE TABLE order_items (
    order_item_id   BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id        BIGINT NOT NULL,
    variant_id      INT NOT NULL,
    quantity        INT NOT NULL,
    unit_price      DECIMAL(12,2) NOT NULL COMMENT 'Snapshot giá tại thời điểm bán',
    line_discount   DECIMAL(12,2) NOT NULL DEFAULT 0,
    FOREIGN KEY (order_id)   REFERENCES orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES product_variants(variant_id)
) ENGINE=InnoDB;

-- Quan hệ N-N đơn hàng - khuyến mãi (1 đơn có thể áp nhiều voucher)
CREATE TABLE order_promotions (
    order_id         BIGINT NOT NULL,
    promotion_id     INT NOT NULL,
    discount_applied DECIMAL(12,2) NOT NULL,
    PRIMARY KEY (order_id, promotion_id),
    FOREIGN KEY (order_id)     REFERENCES orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (promotion_id) REFERENCES promotions(promotion_id)
) ENGINE=InnoDB;

-- Lịch sử trạng thái đơn hàng (audit trail, phục vụ realtime notify + báo cáo)
CREATE TABLE order_status_history (
    history_id  BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id    BIGINT NOT NULL,
    status      VARCHAR(30) NOT NULL,
    changed_by  INT NULL COMMENT 'account_id thực hiện thay đổi',
    changed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    note        VARCHAR(255),
    FOREIGN KEY (order_id)   REFERENCES orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by) REFERENCES accounts(account_id)
) ENGINE=InnoDB;

-- Trả hàng / đổi hàng
CREATE TABLE order_returns (
    return_id     BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id      BIGINT NOT NULL,
    return_type   ENUM('return','exchange') NOT NULL,
    reason        VARCHAR(255),
    status        ENUM('requested','approved','rejected','completed') NOT NULL DEFAULT 'requested',
    processed_by  INT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id)      REFERENCES orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (processed_by)  REFERENCES accounts(account_id)
) ENGINE=InnoDB;

CREATE TABLE order_return_items (
    return_item_id      BIGINT AUTO_INCREMENT PRIMARY KEY,
    return_id           BIGINT NOT NULL,
    order_item_id       BIGINT NOT NULL,
    quantity            INT NOT NULL,
    exchange_variant_id INT NULL COMMENT 'Biến thể đổi sang (nếu là exchange)',
    FOREIGN KEY (return_id)            REFERENCES order_returns(return_id) ON DELETE CASCADE,
    FOREIGN KEY (order_item_id)        REFERENCES order_items(order_item_id),
    FOREIGN KEY (exchange_variant_id)  REFERENCES product_variants(variant_id)
) ENGINE=InnoDB;

-- ============================================================================
-- MODULE 5: THANH TOÁN (API ngoài: VNPay/Momo cho online, QR/tiền mặt tại quầy)
-- ============================================================================

CREATE TABLE payments (
    payment_id       BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id         BIGINT NOT NULL,
    payment_method   ENUM('vnpay','momo','cash','qr_pos','bank_transfer','stripe') NOT NULL,
    amount           DECIMAL(12,2) NOT NULL,
    transaction_code VARCHAR(100) NULL COMMENT 'Mã giao dịch trả về từ cổng thanh toán',
    payment_status   ENUM('pending','success','failed','refunded') NOT NULL DEFAULT 'pending',
    paid_at          DATETIME NULL,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE payment_refunds (
    refund_id    BIGINT AUTO_INCREMENT PRIMARY KEY,
    payment_id   BIGINT NOT NULL,
    amount       DECIMAL(12,2) NOT NULL,
    reason       VARCHAR(255),
    status       ENUM('pending','completed','rejected') NOT NULL DEFAULT 'pending',
    processed_by INT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (payment_id)   REFERENCES payments(payment_id) ON DELETE CASCADE,
    FOREIGN KEY (processed_by) REFERENCES accounts(account_id)
) ENGINE=InnoDB;

-- ============================================================================
-- MODULE 6: REALTIME & CHATBOT HỖ TRỢ
-- ============================================================================

CREATE TABLE faqs (
    faq_id      INT AUTO_INCREMENT PRIMARY KEY,
    question    VARCHAR(500) NOT NULL,
    answer      TEXT NOT NULL,
    is_active   TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE ai_chat_messages (
    message_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    sender_type ENUM('customer','bot') NOT NULL,
    message_content TEXT NOT NULL,
    sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ai_chat_customer_message (customer_id, message_id),
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE chat_conversations (
    conversation_id   BIGINT AUTO_INCREMENT PRIMARY KEY,
    customer_id       INT NULL,
    staff_id          INT NULL COMMENT 'NULL nếu đang chat với chatbot',
    conversation_type ENUM('bot','human') NOT NULL DEFAULT 'bot',
    started_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at          DATETIME NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
    FOREIGN KEY (staff_id)    REFERENCES accounts(account_id)
) ENGINE=InnoDB;

CREATE TABLE chat_read_receipts (
    conversation_id BIGINT NOT NULL,
    account_id INT NOT NULL,
    last_read_message_id BIGINT NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (conversation_id, account_id),
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations(conversation_id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE chat_messages (
    message_id      BIGINT AUTO_INCREMENT PRIMARY KEY,
    conversation_id BIGINT NOT NULL,
    sender_type     ENUM('customer','staff','bot') NOT NULL,
    sender_id       INT NULL,
    message_content TEXT NOT NULL,
    sent_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations(conversation_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- [FIX-2] notifications: Sửa Polymorphic FK vi phạm BCNF
--   Trước: recipient_type ENUM + recipient_id INT → MySQL không thể tạo FK thực sự,
--          không có referential integrity, xóa customer/account không cascade được
--   Sau:   2 cột nullable riêng biệt với FK thực sự + CHECK constraint đảm bảo
--          chỉ 1 trong 2 có giá trị (XOR constraint)
CREATE TABLE notifications (
    notification_id  BIGINT AUTO_INCREMENT PRIMARY KEY,
    -- Người nhận: chỉ 1 trong 2 được có giá trị (enforced bởi CHECK bên dưới)
    customer_id      INT NULL COMMENT 'Thông báo gửi cho khách hàng',
    account_id       INT NULL COMMENT 'Thông báo gửi cho nhân viên/admin',
    notif_type       VARCHAR(50) NOT NULL COMMENT 'NEW_ORDER, ORDER_STATUS_UPDATE, CHAT_MESSAGE...',
    content          VARCHAR(500) NOT NULL,
    related_order_id BIGINT NULL,
    target_url       VARCHAR(500) NULL,
    related_message_id BIGINT NULL,
    is_read          TINYINT(1) NOT NULL DEFAULT 0,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id)      REFERENCES customers(customer_id) ON DELETE CASCADE,
    FOREIGN KEY (account_id)       REFERENCES accounts(account_id)   ON DELETE CASCADE,
    FOREIGN KEY (related_order_id) REFERENCES orders(order_id)        ON DELETE SET NULL,
    -- NOTE: MySQL Error 3823 — CHECK constraint với FK ON DELETE CASCADE không được phép.
    --       Dùng TRIGGER bên dưới để enforce XOR: đúng 1 trong 2 phải có giá trị.
    -- Index tối ưu truy vấn "lấy thông báo chưa đọc của user X"
    INDEX idx_notif_customer (customer_id, is_read),
    INDEX idx_notif_account  (account_id,  is_read)
) ENGINE=InnoDB;

-- Trigger thay thế XOR CHECK constraint cho notifications
DELIMITER $$
CREATE TRIGGER trg_notifications_before_insert
BEFORE INSERT ON notifications
FOR EACH ROW
BEGIN
    -- Đảm bảo XOR: đúng 1 trong 2 phải có giá trị, không được cả 2 hoặc cả 2 NULL
    IF NOT (
        (NEW.customer_id IS NOT NULL AND NEW.account_id IS NULL) OR
        (NEW.customer_id IS NULL     AND NEW.account_id IS NOT NULL)
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'notifications: Phải có đúng 1 recipient (customer_id hoặc account_id)';
    END IF;
END$$

CREATE TRIGGER trg_notifications_before_update
BEFORE UPDATE ON notifications
FOR EACH ROW
BEGIN
    IF NOT (
        (NEW.customer_id IS NOT NULL AND NEW.account_id IS NULL) OR
        (NEW.customer_id IS NULL     AND NEW.account_id IS NOT NULL)
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'notifications: Phải có đúng 1 recipient (customer_id hoặc account_id)';
    END IF;
END$$
DELIMITER ;

-- ============================================================================
-- MODULE 9: THỐNG KÊ & BÁO CÁO
-- Không tạo bảng riêng (tránh dư thừa dữ liệu / vi phạm chuẩn hóa).
-- Dùng VIEW tổng hợp real-time từ dữ liệu gốc.
-- ============================================================================

-- 9.1 Doanh thu theo kênh (Online vs POS)
CREATE OR REPLACE VIEW vw_revenue_by_channel AS
SELECT
    o.channel,
    DATE(o.created_at)          AS sale_date,
    COUNT(DISTINCT o.order_id)  AS total_orders,
    SUM(o.total_amount)         AS total_revenue
FROM orders o
WHERE o.order_status = 'completed'
GROUP BY o.channel, DATE(o.created_at);

-- 9.2 Sản phẩm bán chạy theo kênh
CREATE OR REPLACE VIEW vw_best_selling_products AS
SELECT
    o.channel,
    p.product_id,
    p.product_name,
    SUM(oi.quantity)                                        AS total_sold,
    SUM(oi.quantity * oi.unit_price - oi.line_discount)    AS total_revenue
FROM order_items oi
JOIN orders o             ON oi.order_id  = o.order_id
JOIN product_variants pv  ON oi.variant_id = pv.variant_id
JOIN products p           ON pv.product_id = p.product_id
WHERE o.order_status = 'completed'
GROUP BY o.channel, p.product_id, p.product_name;

-- 9.3 Thống kê tồn kho (theo sản phẩm + chi nhánh)
CREATE OR REPLACE VIEW vw_inventory_summary AS
SELECT
    p.product_id,
    p.product_name,
    b.branch_id,
    b.branch_name,
    SUM(i.quantity) AS total_stock
FROM inventory i
JOIN product_variants pv  ON i.variant_id  = pv.variant_id
JOIN products p           ON pv.product_id = p.product_id
JOIN branches b           ON i.branch_id   = b.branch_id
GROUP BY p.product_id, p.product_name, b.branch_id, b.branch_name;

-- 9.4 Thống kê khách hàng (số đơn, tổng chi tiêu)
CREATE OR REPLACE VIEW vw_customer_stats AS
SELECT
    c.customer_id,
    c.full_name,
    COUNT(o.order_id)                   AS total_orders,
    COALESCE(SUM(o.total_amount), 0)    AS total_spent,
    MAX(o.created_at)                   AS last_order_date
FROM customers c
LEFT JOIN orders o ON c.customer_id = o.customer_id AND o.order_status = 'completed'
GROUP BY c.customer_id, c.full_name;

-- 9.5 Thống kê hiệu quả khuyến mãi
CREATE OR REPLACE VIEW vw_promotion_stats AS
SELECT
    pr.promotion_id,
    pr.promo_code,
    pr.promo_name,
    COUNT(DISTINCT op.order_id)     AS times_used,
    SUM(op.discount_applied)        AS total_discount_given,
    pr.max_usage_count
FROM promotions pr
LEFT JOIN order_promotions op ON pr.promotion_id = op.promotion_id
GROUP BY pr.promotion_id, pr.promo_code, pr.promo_name, pr.max_usage_count;

-- ============================================================================
-- MODULE 10: HỖ TRỢ KHÁCH HÀNG (Support Chat)
-- ============================================================================

-- ============================================================================
-- DỮ LIỆU MẪU KHỞI TẠO (Seed Data)
-- ============================================================================

-- Roles hệ thống
CREATE TABLE IF NOT EXISTS system_settings (
 setting_key VARCHAR(100) PRIMARY KEY,
 setting_value TEXT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Migration tracking and single-use password recovery tokens
CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_key VARCHAR(100) PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS password_reset_otps (
    request_id CHAR(64) PRIMARY KEY,
    code_hash VARCHAR(255) NOT NULL,
    verified_at DATETIME NULL,
    reset_token_hash CHAR(64) NULL UNIQUE,
    reset_expires_at DATETIME NULL,
    account_id INT NULL,
    customer_id INT NULL,
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE,
    INDEX idx_otp_expiry (expires_at),
    INDEX idx_otp_account_created (account_id, created_at),
    INDEX idx_otp_customer_created (customer_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    reset_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    token_hash CHAR(64) NOT NULL UNIQUE,
    account_id INT NULL, customer_id INT NULL,
    expires_at DATETIME NOT NULL, used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE,
    INDEX idx_reset_expiry (expires_at)
) ENGINE=InnoDB;
