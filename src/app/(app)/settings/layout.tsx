import { PageHeader } from "@/components/layout/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { PageContainer } from "@/components/layout/page-container";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageContainer>
      <PageHeader title="Settings" className="mb-4" />
      <div className="max-w-[720px]">
        <SettingsTabs />
        {children}
      </div>
    </PageContainer>
  );
}
