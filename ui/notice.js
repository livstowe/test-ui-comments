export function wireNotice(notice, dismissButton, restoreButton) {
  dismissButton.addEventListener('click', () => {
    notice.hidden = true;
    restoreButton.hidden = false;
    restoreButton.focus({ preventScroll: true });
  });
  restoreButton.addEventListener('click', () => {
    notice.hidden = false;
    restoreButton.hidden = true;
    dismissButton.focus({ preventScroll: true });
  });
}
