import { PageHeader } from "@/components/layout/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[720px]">
      <PageHeader title="Settings" className="mb-4" />
      <SettingsTabs />
      {children}
    </div>
  );
}
