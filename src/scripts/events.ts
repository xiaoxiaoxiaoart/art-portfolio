export function initEventPreviews(): void {
  let previewImg: HTMLImageElement | null = null;
  const previews = document.querySelectorAll<HTMLElement>('[data-event-preview]');

  previews.forEach(el => {
    el.addEventListener('mouseenter', () => {
      const container = el.closest('.events-page')?.querySelector('.preview-panel') as HTMLElement;
      if (!container) return;

      if (!previewImg) {
        previewImg = document.createElement('img');
        previewImg.alt = '';
        container.appendChild(previewImg);
      }

      const url = el.dataset.eventPreview!;
      previewImg.src = url;
      previewImg.style.opacity = '1';

      previewImg.onload = () => {
        if (!previewImg) return;
        const elTop = el.getBoundingClientRect().top;
        const containerTop = container.getBoundingClientRect().top;
        const containerH = container.clientHeight;
        const imgH = previewImg.offsetHeight;
        let offset = elTop - containerTop;
        if (offset + imgH > containerH) offset = containerH - imgH;
        if (offset < 0) offset = 0;
        previewImg.style.top = offset + 'px';
      };
    });

    el.addEventListener('mouseleave', () => {
      if (previewImg) previewImg.style.opacity = '0';
    });
  });
}
