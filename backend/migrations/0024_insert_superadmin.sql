-- +migrate Up

-- Only when no superadmin exists at all, so an existing console login is never touched
INSERT INTO superadmin_users (name, username, password_hash, is_active, created_at, updated_at)
SELECT 'Super Admin', 'superadmin', '$2a$12$if64pSLthGY8T3xoV8CXZuCzG2axbEtMJ8OGaMT1QOwQbCgxhla2C', TRUE, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM superadmin_users);

-- +migrate Down

DELETE FROM superadmin_users WHERE username = 'superadmin' AND password_hash = '$2a$12$if64pSLthGY8T3xoV8CXZuCzG2axbEtMJ8OGaMT1QOwQbCgxhla2C';
