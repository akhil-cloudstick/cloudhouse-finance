"use client";

import { useEffect, useState } from "react";
import { listDesktopReleaseHistory } from "@/modules/superadmin/services/superadminService";
import { DesktopVersions, type DesktopVersion } from "@/modules/superadmin/kit/components/DesktopVersions";

type DesktopReleaseHistoryProps = { tenantCode: string; refreshKey?: number };

/* Gold Finance's desktop versions (every finished build it keeps) in the shared Desktop app card. */
export function DesktopReleaseHistory({ tenantCode, refreshKey }: DesktopReleaseHistoryProps) {
  const [versions, setVersions] = useState<DesktopVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listDesktopReleaseHistory(tenantCode).then(
      (res) => {
        if (!live) return;
        setVersions(res.map((e) => ({ os: e.os, version: e.version, url: e.downloadUrl })));
        setError(null);
      },
      (err) => {
        if (!live) return;
        setVersions([]);
        setError(err instanceof Error ? err.message : "Could not load the desktop versions.");
      },
    );
    return () => {
      live = false;
    };
  }, [tenantCode, refreshKey]);

  return <DesktopVersions versions={versions} error={error} />;
}
