import { Bold, Code, Italic, Link2, List, Pencil } from 'lucide-react';
import { useRef, useState, type RefObject } from 'react';
import ReactMarkdown from 'react-markdown';

import { Button, IconButton } from '../../components/ui/Button';
import { Textarea } from '../../components/ui/Input';
import { cn } from '../../lib/cn';

function applyMarkdownWrap(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  onChange: (value: string) => void,
) {
  const { selectionStart, selectionEnd, value } = textarea;
  const selected = value.slice(selectionStart, selectionEnd);
  const next =
    value.slice(0, selectionStart) + before + selected + after + value.slice(selectionEnd);
  onChange(next);
  const cursor = selectionStart + before.length + selected.length + after.length;
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(
      selectionStart + before.length,
      selectionStart + before.length + selected.length,
    );
    if (!selected) textarea.setSelectionRange(cursor, cursor);
  });
}

function MarkdownToolbar({
  textareaRef,
  onChange,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
}) {
  const wrap = (before: string, after = before) => {
    const el = textareaRef.current;
    if (!el) return;
    applyMarkdownWrap(el, before, after, onChange);
  };

  return (
    <div
      className="flex flex-wrap items-center gap-0.5 rounded-t-md border border-b-0 border-line bg-surface-raised px-1 py-1"
      role="toolbar"
      aria-label="Markdown formatting"
    >
      {(
        [
          ['Bold', Bold, '**', '**'],
          ['Italic', Italic, '*', '*'],
          ['Code', Code, '`', '`'],
          ['Bullet list', List, '\n- ', ''],
          ['Link', Link2, '[', '](url)'],
        ] as const
      ).map(([label, Icon, open, close]) => (
        <IconButton
          key={label}
          type="button"
          size="sm"
          label={label}
          className="text-fg-muted hover:text-fg"
          onClick={() => {
            wrap(open, close);
          }}
        >
          <Icon className="size-4" aria-hidden="true" />
        </IconButton>
      ))}
    </div>
  );
}

function MarkdownBody({ source }: { source: string }) {
  if (!source.trim()) {
    return <span className="text-fg-muted">No description.</span>;
  }
  return (
    <div className="prose prose-sm max-w-none text-fg prose-headings:text-fg prose-p:leading-relaxed prose-a:text-accent prose-code:rounded prose-code:bg-surface-raised prose-code:px-1 prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown disallowedElements={['img', 'script', 'style', 'iframe']} unwrapDisallowed>
        {source}
      </ReactMarkdown>
    </div>
  );
}

export function IssueDescriptionSection({
  description,
  canEdit,
  saving,
  editing,
  draft,
  onStartEdit,
  onDraftChange,
  onSave,
  onCancel,
}: {
  description: string | null;
  canEdit: boolean;
  saving: boolean;
  editing: boolean;
  draft: string;
  onStartEdit: () => void;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showPreview, setShowPreview] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="description-title" className="text-base font-semibold text-fg">
          Description
        </h2>
        {canEdit && !editing ? (
          <IconButton
            type="button"
            size="sm"
            label="Edit description"
            className="shrink-0 text-fg-muted hover:text-fg"
            onClick={() => {
              setShowPreview(false);
              onStartEdit();
            }}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>

      {editing ? (
        <div className="rounded-lg border border-line bg-surface shadow-sm ring-1 ring-accent/10">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant={showPreview ? 'ghost' : 'secondary'}
                onClick={() => {
                  setShowPreview(false);
                }}
              >
                Write
              </Button>
              <Button
                type="button"
                size="sm"
                variant={showPreview ? 'secondary' : 'ghost'}
                onClick={() => {
                  setShowPreview(true);
                }}
              >
                Preview
              </Button>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="button" variant="primary" size="sm" disabled={saving} onClick={onSave}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
          {showPreview ? (
            <div className="p-4 sm:p-5">
              <MarkdownBody source={draft} />
            </div>
          ) : (
            <>
              <MarkdownToolbar textareaRef={textareaRef} onChange={onDraftChange} />
              <Textarea
                ref={textareaRef}
                autoFocus
                aria-label="Description"
                className={cn(
                  'min-h-[10rem] rounded-none border-0 text-sm leading-relaxed shadow-none ring-0 focus-visible:ring-0',
                )}
                rows={8}
                maxLength={32000}
                value={draft}
                onChange={(e) => {
                  onDraftChange(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    onCancel();
                  }
                }}
              />
            </>
          )}
        </div>
      ) : (
        <div className="text-sm leading-relaxed">
          <MarkdownBody source={description ?? ''} />
        </div>
      )}
    </div>
  );
}
