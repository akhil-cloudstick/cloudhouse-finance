-- +migrate Up

-- Packets of loans that were rejected are released and no longer occupy a locker slot.
INSERT INTO packet_movements (tenant_id, packet_id, from_status, to_status, locker_id, actor_employee_id, remarks, created_at)
SELECT p.tenant_id, p.id, p.status, 'Released', p.current_locker_id, 0, 'Loan rejected - packet released', NOW()
FROM packets p JOIN loans l ON l.id = p.loan_id
WHERE l.status = 'Rejected' AND p.status <> 'Released';

UPDATE packets SET status = 'Released', current_locker_id = NULL, updated_at = NOW()
WHERE status <> 'Released' AND loan_id IN (SELECT id FROM loans WHERE status = 'Rejected');

-- +migrate Down

SELECT 1;
