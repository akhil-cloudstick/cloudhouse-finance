


export type IconName = "building" | "layers" | "clipboard" | "bell" | "sun" | "user" | "copy" | "external" | "tag" | "mail" | "lock" | "eye" | "eyeOff" | "menu";
/* The wizard's steps. `erp` is the ERP's own first step (customer & plan,
 * create only — see BusinessWizard's erpStep). `admin` sets the first login on create; on edit it is
 * how the vendor resets that login for an owner who has forgotten it. */
export type StepId = "erp" | "profile" | "branding" | "grants" | "admin" | "review";
