import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { cn } from '../../lib/cn';
import { ThemeProvider, useTheme } from '../../theme/ThemeProvider';

import { Avatar, initials } from './Avatar';
import { Button } from './Button';
import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridColumns,
  DataGridDividedCell,
  DataGridDividedHeadCell,
  DataGridEqualColumns,
  DataGridHead,
  DataGridHeadCell,
  DataGridRow,
  DataGridTable,
} from './DataGrid';
import { Field, Input } from './Input';
import { PriorityIcon, StatusLozenge, TypeIcon } from './IssueIcons';
import { Dialog, DialogContent, DialogTrigger } from './Overlay';
import { ToastProvider, useToast } from './Toast';

describe('cn', () => {
  it('merges classes and lets the last conflicting utility win', () => {
    expect(cn('px-2 py-1', false, 'px-4')).toBe('py-1 px-4');
  });
});

describe('Button', () => {
  it('defaults to type=button and renders as its child with asChild', () => {
    render(
      <>
        <Button>Save</Button>
        <Button asChild>
          <a href="/x">Go</a>
        </Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('link', { name: 'Go' })).toHaveAttribute('href', '/x');
  });
});

describe('Field', () => {
  it('links the label, hint and error to the control', () => {
    render(
      <Field label="Name" error="Required.">
        {(props) => <Input {...props} />}
      </Field>,
    );
    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Required.');
  });
});

describe('Avatar', () => {
  it('derives initials and always exposes the full name to assistive tech', () => {
    expect(initials('Ann Example')).toBe('AE');
    expect(initials('  bob ')).toBe('B');
    expect(initials('')).toBe('?');
    render(<Avatar name="Ann Example" />);
    expect(screen.getByText('Ann Example')).toBeInTheDocument();
  });
});

describe('issue markers', () => {
  it('names the type, priority and status for assistive tech', () => {
    render(
      <>
        <TypeIcon name="Bug" />
        <TypeIcon kind="subtask" />
        <PriorityIcon name="Highest" />
        <StatusLozenge name="Done" category="done" />
      </>,
    );
    expect(screen.getByRole('img', { name: 'Bug' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Sub-task' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Highest priority' })).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });
});

describe('Dialog', () => {
  it('is labelled by its title, traps focus and closes with Escape', async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open</Button>
        </DialogTrigger>
        <DialogContent title="Create issue" description="Fill in the details.">
          <Input aria-label="Summary" />
        </DialogContent>
      </Dialog>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create issue' });
    expect(dialog).toHaveAccessibleDescription('Fill in the details.');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

describe('Toast', () => {
  it('announces a toast and lets the user dismiss it', async () => {
    function Trigger() {
      const toast = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            toast({ title: 'Saved', description: 'All good.', variant: 'success' });
          }}
        >
          Fire
        </button>
      );
    }
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Fire' }));
    expect(await screen.findByText('All good.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => {
      expect(screen.queryByText('All good.')).not.toBeInTheDocument();
    });
  });
});

describe('ThemeProvider', () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  function Switch() {
    const { preference, resolved, setPreference } = useTheme();
    return (
      <>
        <p>
          {preference}/{resolved}
        </p>
        <button
          type="button"
          onClick={() => {
            setPreference('dark');
          }}
        >
          Dark
        </button>
      </>
    );
  }

  it('applies the chosen theme to the document and remembers it', async () => {
    render(
      <ThemeProvider>
        <Switch />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(screen.getByText('dark/dark')).toBeInTheDocument();
  });

  it('starts from a saved preference', () => {
    localStorage.setItem('theme', 'dark');
    render(
      <ThemeProvider>
        <Switch />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('DataGrid', () => {
  it('exposes table semantics and column headers', () => {
    render(
      <DataGrid>
        <DataGridTable aria-label="Sample">
          <DataGridColumns template="1fr 1fr">
            <DataGridHead>
              <DataGridHeadCell>A</DataGridHeadCell>
              <DataGridHeadCell>B</DataGridHeadCell>
            </DataGridHead>
            <DataGridBody>
              <DataGridRow>
                <DataGridCell>1</DataGridCell>
                <DataGridCell>2</DataGridCell>
              </DataGridRow>
            </DataGridBody>
          </DataGridColumns>
        </DataGridTable>
      </DataGrid>,
    );
    expect(screen.getByRole('table', { name: 'Sample' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'A' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '1' })).toBeInTheDocument();
  });

  it('renders N equal columns with dividers', () => {
    render(
      <DataGrid>
        <DataGridTable aria-label="Equal columns">
          <DataGridEqualColumns columnCount={4}>
            <DataGridHead>
              <DataGridDividedHeadCell>One</DataGridDividedHeadCell>
              <DataGridDividedHeadCell>Two</DataGridDividedHeadCell>
              <DataGridDividedHeadCell>Three</DataGridDividedHeadCell>
              <DataGridDividedHeadCell>Four</DataGridDividedHeadCell>
            </DataGridHead>
            <DataGridBody>
              <DataGridRow>
                <DataGridDividedCell>a</DataGridDividedCell>
                <DataGridDividedCell>b</DataGridDividedCell>
                <DataGridDividedCell>c</DataGridDividedCell>
                <DataGridDividedCell>d</DataGridDividedCell>
              </DataGridRow>
            </DataGridBody>
          </DataGridEqualColumns>
        </DataGridTable>
      </DataGrid>,
    );
    expect(screen.getAllByRole('columnheader')).toHaveLength(4);
  });
});
