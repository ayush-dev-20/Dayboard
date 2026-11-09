import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TemplateEditor } from "@/components/templates/template-editor";
import { getTemplate } from "@/db/queries/templates";
import { requireUser } from "@/lib/session";
import { idSchema } from "@/lib/validations/tasks";

export const metadata: Metadata = { title: "Template" };

// One template (V3 feature 03 §6). A malformed id, someone else's id and a template in Trash all look like a missing page.
export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser({ redirect: true });
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const template = await getTemplate(user.id, id);
  if (!template) notFound();
  return <TemplateEditor key={`${template.id}:${template.version}`} template={template} />;
}
