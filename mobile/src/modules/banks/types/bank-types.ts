export type Bank = {
  id: number;
  name: string;
  branch?: string;
  ifsc?: string;
  accountNo?: string;
  phone?: string;
  // From GET /banks: the business branch it belongs to, its balance (negative when overdrawn) and what is re-pledged to it.
  branchId?: number;
  branchName?: string;
  balance?: number;
  activePledgeCount?: number;
  activePledgeAmount?: number;
  createdAt: string;
  updatedAt: string;
};
