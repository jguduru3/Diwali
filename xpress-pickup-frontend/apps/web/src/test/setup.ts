import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import '../i18n';

// jsdom does not implement scrolling.
window.scrollTo = () => {};

// jsdom has <dialog> but not its modal methods.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

// The first-visit "How it works" sheet is tested on its own; elsewhere it has been seen.
beforeEach(() => {
  localStorage.setItem('pp.howSeen.customer', '1');
  localStorage.setItem('pp.howSeen.merchant', '1');
});

afterEach(() => cleanup());
