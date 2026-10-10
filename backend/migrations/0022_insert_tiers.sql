-- +migrate Up

-- Plan catalogue a business is created on; branch_quota 0 means unlimited
INSERT INTO tiers (name, branch_quota, price_in_paise, is_active, created_at, updated_at) SELECT 'Single Branch', 1, 0, TRUE, NOW(), NOW() WHERE NOT EXISTS (SELECT 1 FROM tiers WHERE name = 'Single Branch');
INSERT INTO tiers (name, branch_quota, price_in_paise, is_active, created_at, updated_at) SELECT 'Up to 5 Branches', 5, 0, TRUE, NOW(), NOW() WHERE NOT EXISTS (SELECT 1 FROM tiers WHERE name = 'Up to 5 Branches');
INSERT INTO tiers (name, branch_quota, price_in_paise, is_active, created_at, updated_at) SELECT 'Unlimited', 0, 0, TRUE, NOW(), NOW() WHERE NOT EXISTS (SELECT 1 FROM tiers WHERE name = 'Unlimited');

-- +migrate Down

DELETE FROM tiers
WHERE name IN ('Single Branch', 'Up to 5 Branches', 'Unlimited')
	AND NOT EXISTS (SELECT 1 FROM tenants WHERE tenants.tier_id = tiers.id);
