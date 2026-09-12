// Modal dismissal must work even if another admin module fails to initialize.
document.addEventListener('click', event => {
    const button = event.target.closest('[data-close-dialog]');
    if (!button) return;
    const dialog = document.getElementById(button.dataset.closeDialog);
    if (dialog) dialog.style.display = 'none';
});
