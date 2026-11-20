/* A customer as the local copy holds them before the server has numbered them. Until then the id the screens
 * use is uuid:<uuid>, which every customer route and the new-loan form accept, and the code is empty. */

import type { BackendCustomer, CustomerFormInput } from "@/modules/customers/types/customer-types";

export const UUID_ID = "uuid:";

export function customerRef(id: string): number | string {
	return id.startsWith(UUID_ID) ? id : Number(id);
}

export function buildOptimisticCustomer(uuid: string, input: CustomerFormInput, hint?: { branchName?: string }): BackendCustomer {
	const now = new Date().toISOString();
	const aadhaar = (input.aadhaar ?? "").replace(/\D/g, "");
	return {
		uuid,
		id: 0,
		code: "",
		name: input.name,
		phone: input.phone,
		dob: input.dob ?? "",
		address: input.address,
		branchId: input.branchId,
		branch: { id: input.branchId, name: hint?.branchName ?? "" },
		photoUrl: input.photoUrl,
		identityProofUrl: input.identityProofUrl,
		addressProofUrl: input.addressProofUrl,
		kycDocumentUrl: input.kycDocumentUrl,
		pan: input.pan,
		aadhaarLast4: aadhaar.slice(-4),
		nomineeName: input.nomineeName,
		nomineeRelation: input.nomineeRelation,
		nomineePhone: input.nomineePhone,
		kycStatus: "Pending",
		panStatus: "Pending",
		aadhaarStatus: "Pending",
		fatherName: input.fatherName,
		district: input.district,
		taluk: input.taluk,
		village: input.village,
		place: input.place,
		pinCode: input.pinCode,
		age: input.age,
		customerType: input.customerType ?? "Borrower",
		bankAccountName: input.bankAccountName,
		bankAccountNumber: input.bankAccountNumber,
		bankIfsc: input.bankIfsc,
		createdAt: now,
		updatedAt: now,
	} as unknown as BackendCustomer;
}
