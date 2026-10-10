import React from "react";
import { FlatHeader, NoticeBanner, openPage, PrimaryButton, PScroll, Screen } from "@/common/components/ui";

type NoAccessProps = { header?: React.ReactNode };

/** The page shown in place of one the signed-in user may not view. */
export function NoAccess({ header = <FlatHeader title="No access" /> }: NoAccessProps) {
  return (
    <Screen header={header}>
      <PScroll contentContainerStyle={{ paddingTop: 16, paddingHorizontal: 18 }}>
        <NoticeBanner>You do not have access to this page. Ask your administrator to grant the permission for it.</NoticeBanner>
        <PrimaryButton label="Back to Dashboard" variant="outline" onPress={() => openPage("/dashboard")} style={{ marginTop: 14 }} />
      </PScroll>
    </Screen>
  );
}
