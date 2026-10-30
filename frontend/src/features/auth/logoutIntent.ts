let logoutIntent = false;

export function setLogoutIntent(active: boolean): void {
  logoutIntent = active;
}

export function getLogoutIntent(): boolean {
  return logoutIntent;
}

export function resetLogoutIntentForTests(): void {
  logoutIntent = false;
}
