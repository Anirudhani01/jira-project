import { Bell, Plus, Search } from 'lucide-react';

import { Avatar, AvatarStack } from '../components/ui/Avatar';
import { Badge, Count } from '../components/ui/Badge';
import { Button, IconButton } from '../components/ui/Button';
import { Card, EmptyState, Skeleton } from '../components/ui/Card';
import { Field, Input, Textarea } from '../components/ui/Input';
import { PriorityIcon, StatusLozenge, TypeIcon } from '../components/ui/IssueIcons';
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
} from '../components/ui/Overlay';
import { useToast } from '../components/ui/Toast';
import { useTheme, type ThemePreference } from '../theme/ThemeProvider';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`ds-${title}`} className="space-y-3">
      <h2 id={`ds-${title}`} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Development-only component gallery (route `/__design`): every primitive and state in one
 * place, used for visual QA and the accessibility checks. */
export function DesignPage() {
  const { preference, setPreference } = useTheme();
  const toast = useToast();
  return (
    <div className="space-y-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Design system</h1>
        <label className="flex items-center gap-2 text-sm">
          Theme
          <select
            value={preference}
            onChange={(e) => {
              setPreference(e.target.value as ThemePreference);
            }}
            className="h-8 rounded-md border border-line-strong bg-surface px-2"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </header>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="subtle">Subtle</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="link">Link</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="primary" size="sm">
            <Plus className="size-4" aria-hidden="true" /> Small
          </Button>
          <Tooltip label="Notifications">
            <IconButton label="Notifications">
              <Bell className="size-4" aria-hidden="true" />
            </IconButton>
          </Tooltip>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid max-w-md gap-3">
          <Field label="Summary" hint="A short, specific title.">
            {(props) => <Input placeholder="e.g. Login button misaligned" {...props} />}
          </Field>
          <Field label="Search" error="Enter at least two characters.">
            {(props) => (
              <div className="relative">
                <Search
                  className="absolute left-2 top-2 size-4 text-fg-subtle"
                  aria-hidden="true"
                />
                <Input className="pl-8" defaultValue="a" {...props} />
              </div>
            )}
          </Field>
          <Field label="Description">{(props) => <Textarea {...props} />}</Field>
        </div>
      </Section>

      <Section title="Issue markers">
        <div className="flex flex-wrap items-center gap-4">
          {(['Epic', 'Story', 'Task', 'Bug', 'Sub-task'] as const).map((name) => (
            <span key={name} className="flex items-center gap-1.5">
              <TypeIcon name={name} /> {name}
            </span>
          ))}
          {(['Highest', 'High', 'Medium', 'Low', 'Lowest'] as const).map((name) => (
            <span key={name} className="flex items-center gap-1">
              <PriorityIcon name={name} /> {name}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusLozenge name="To Do" category="todo" />
          <StatusLozenge name="In Progress" category="in_progress" />
          <StatusLozenge name="Done" category="done" />
          <Badge tone="warning">Over WIP</Badge>
          <Badge tone="danger">Blocked</Badge>
          <Badge tone="accent">Epic</Badge>
          <Count>12</Count>
        </div>
        <div className="flex items-center gap-4">
          <Avatar name="Ann Example" />
          <Avatar name="Bob" size="md" />
          <AvatarStack
            names={['Ann Example', 'Bob Stone', 'Cy Park', 'Di Lee', 'Ed Roe', 'Fay Wu']}
          />
        </div>
      </Section>

      <Section title="Surfaces">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="space-y-2 p-4">
            <h3 className="font-semibold">Card</h3>
            <p className="text-fg-muted">
              Raised surface with a hairline border and a soft shadow.
            </p>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </Card>
          <EmptyState
            title="No issues yet"
            description="Create the first issue to start planning this sprint."
            action={{ label: 'Create issue', onClick: () => undefined }}
          />
        </div>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button>Open dialog</Button>
            </DialogTrigger>
            <DialogContent title="Create issue" description="Fill in the details below.">
              <Field label="Summary">{(props) => <Input {...props} />}</Field>
            </DialogContent>
          </Dialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>Menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Issue</DropdownMenuLabel>
              <DropdownMenuItem>Edit</DropdownMenuItem>
              <DropdownMenuItem>Move to…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Popover>
            <PopoverTrigger asChild>
              <Button>Popover</Button>
            </PopoverTrigger>
            <PopoverContent>You are all caught up.</PopoverContent>
          </Popover>
          <Button
            onClick={() => {
              toast({
                title: 'Saved',
                description: 'Your changes were saved.',
                variant: 'success',
              });
            }}
          >
            Success toast
          </Button>
          <Button
            onClick={() => {
              toast({
                title: 'Could not save',
                description: 'Reload and try again.',
                variant: 'error',
              });
            }}
          >
            Error toast
          </Button>
        </div>
        <Tabs defaultValue="all">
          <TabsList aria-label="Activity filter">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="comments">Comments</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent value="all" className="py-3 text-fg-muted">
            Everything that happened on this issue.
          </TabsContent>
          <TabsContent value="comments" className="py-3 text-fg-muted">
            Comments only.
          </TabsContent>
          <TabsContent value="history" className="py-3 text-fg-muted">
            Field changes only.
          </TabsContent>
        </Tabs>
      </Section>
    </div>
  );
}
