"use client";



export type IconName = "building" | "layers" | "clipboard" | "bell" | "sun" | "user" | "copy" | "external";
/* The wizard's steps. `admin` sets the first login on create; on edit it is
 * how the vendor resets that login for an owner who has forgotten it. */
export type StepId = "profile" | "branding" | "grants" | "admin" | "review";
