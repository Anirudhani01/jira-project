import { useState } from 'react';

import { cn } from '../../lib/cn';

import { ProjectSidebarNav } from './ProjectSidebarNav';
import { readSidebarCollapsed } from './storage';
import { useShell } from './ShellContext';
import { useShowProjectSidebar } from './useProjectContext';

export function ProjectSidebar() {
  const show = useShowProjectSidebar();
  const [collapsed, setCollapsed] = useState(() => readSidebarCollapsed());

  if (!show) return null;

  return (
    <aside
      className={cn(
        'hidden shrink-0 border-r border-line bg-surface lg:block',
        collapsed ? 'w-14' : 'w-56',
      )}
    >
      <ProjectSidebarNav collapsed={collapsed} onCollapsedChange={setCollapsed} />
    </aside>
  );
}

export function MobileProjectDrawer() {
  const show = useShowProjectSidebar();
  const { mobileNavOpen, setMobileNavOpen } = useShell();
  const [collapsed, setCollapsed] = useState(false);

  if (!show || !mobileNavOpen) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        aria-label="Close navigation"
        className="absolute inset-0 bg-black/40"
        onClick={() => {
          setMobileNavOpen(false);
        }}
      />
      <aside className="relative h-full w-64 border-r border-line bg-surface shadow-lg">
        <ProjectSidebarNav
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          onNavigate={() => {
            setMobileNavOpen(false);
          }}
        />
      </aside>
    </div>
  );
}
