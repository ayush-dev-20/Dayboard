"use client";

import { ChevronDown } from "lucide-react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { EmojiButton } from "@/components/emoji/emoji-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CALLOUT_TONES, DEFAULT_CALLOUT_EMOJI, type CalloutTone } from "@/lib/editor/limits";

const TONE_LABELS: Record<CalloutTone, string> = {
  neutral: "Neutral",
  info: "Info",
  success: "Success",
  warning: "Warning",
};

/**
 * A highlighted box with an emoji and rich text. The tone is a quiet tint; the emoji and the
 * words carry the meaning, never the colour alone (DESIGN.md), and there is no red tone.
 */
export function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const tone = (node.attrs.tone as CalloutTone) ?? "neutral";
  const emoji = (node.attrs.emoji as string) || DEFAULT_CALLOUT_EMOJI;

  return (
    <NodeViewWrapper className="callout" data-tone={tone} role="note" aria-label="Callout">
      <div contentEditable={false} className="callout-chrome">
        <EmojiButton
          value={emoji}
          label="Callout emoji"
          className="size-9 md:size-8"
          onChange={(next) => updateAttributes({ emoji: next ?? DEFAULT_CALLOUT_EMOJI })}
        />
        {editor.isEditable ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Callout style: ${TONE_LABELS[tone]}`}
              className="callout-tone inline-flex h-6 items-center gap-0.5 rounded-sm px-1 type-body-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {TONE_LABELS[tone]}
              <ChevronDown className="size-3.5" strokeWidth={1.5} aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
              <DropdownMenuRadioGroup
                value={tone}
                onValueChange={(value) => updateAttributes({ tone: value })}
              >
                {CALLOUT_TONES.map((value) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {TONE_LABELS[value]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  );
}
