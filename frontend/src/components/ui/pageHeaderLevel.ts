import { createContext } from 'react';

/** Heading level `PageHeader` renders. Pages embedded under a parent page title (such as the
 * organization dashboard tabs) provide 2 so the page keeps a single h1. */
export const PageHeaderLevelContext = createContext<1 | 2>(1);
