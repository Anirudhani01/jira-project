import { focusColumn, projectOf, projectTabLink, targetIssueKey } from './targetIssue';

afterEach(() => {
  document.body.innerHTML = '';
});

function board() {
  document.body.innerHTML = `
    <nav aria-label="Project"><a href="/b">Board</a><a href="/l">List</a></nav>
    <section data-board-column id="c1"><ul>
      <li data-issue-row data-issue-key="WEB-1"><a href="/o/a/issues/WEB-1">WEB-1</a></li>
    </ul></section>
    <section data-board-column id="c2"><button id="add2">Add</button></section>
    <section data-board-column id="c3"><ul>
      <li data-issue-row data-issue-key="WEB-3"><a href="/o/a/issues/WEB-3">WEB-3</a></li>
    </ul></section>`;
}

describe('targetIssueKey', () => {
  it('prefers the focused row, then the issue page in the URL', () => {
    board();
    const link = document.querySelector<HTMLElement>('a[href*="WEB-3"]');
    expect(targetIssueKey('/o/a/p/WEB/board', link)).toBe('WEB-3');
    expect(targetIssueKey('/o/a/issues/web-9', document.body)).toBe('WEB-9');
    expect(targetIssueKey('/o/a/p/WEB/board', document.body)).toBeNull();
    expect(targetIssueKey('/o/a/issues/not-a-key', null)).toBeNull();
  });
  it('derives the project key', () => {
    expect(projectOf('WEB-12')).toBe('WEB');
    expect(projectOf('AB1-3')).toBe('AB1');
  });
});

describe('focusColumn', () => {
  it('hops between columns, landing on a card or the first button of an empty column', () => {
    board();
    expect(focusColumn(1)).toBe(true); // nothing focused: first column
    expect(document.activeElement?.getAttribute('href')).toBe('/o/a/issues/WEB-1');
    focusColumn(1);
    expect(document.activeElement?.id).toBe('add2');
    focusColumn(1);
    expect(document.activeElement?.getAttribute('href')).toBe('/o/a/issues/WEB-3');
    focusColumn(1); // already in the last column: stays
    expect(document.activeElement?.getAttribute('href')).toBe('/o/a/issues/WEB-3');
    focusColumn(-1);
    expect(document.activeElement?.id).toBe('add2');
  });
  it('does nothing without columns', () => {
    document.body.innerHTML = '<p>no board</p>';
    expect(focusColumn(1)).toBe(false);
  });
});

describe('projectTabLink', () => {
  it('returns the Nth project tab', () => {
    board();
    expect(projectTabLink(1)?.textContent).toBe('Board');
    expect(projectTabLink(2)?.textContent).toBe('List');
    expect(projectTabLink(3)).toBeNull();
  });
});
