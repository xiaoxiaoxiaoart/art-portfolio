export function initEventPreviews(): void {
  let previewImg: HTMLImageElement | null = null;
  const previews = document.querySelectorAll<HTMLElement>('[data-event-preview]');

  previews.forEach(el => {
    el.addEventListener('mouseenter', () => {
      const page = el.closest('.events-page') as HTMLElement;
      const panel = page?.querySelector('.preview-panel') as HTMLElement;
      const list = page?.querySelector('.events-list') as HTMLElement;
      if (!panel || !list) return;

      if (!previewImg) {
        previewImg = document.createElement('img');
        previewImg.alt = '';
        panel.appendChild(previewImg);
      }

      const url = el.dataset.eventPreview!;
      previewImg.src = url;
      previewImg.style.opacity = '1';

      previewImg.onload = () => {
        if (!previewImg) return;
        const listTop = list.getBoundingClientRect().top;
        const elTop = el.getBoundingClientRect().top;
        const imgH = previewImg.offsetHeight;
        const panelH = panel.clientHeight;
        let offset = elTop - listTop;
        if (offset + imgH > panelH) offset = panelH - imgH;
        if (offset < 0) offset = 0;
        previewImg.style.top = offset + 'px';
      };
    });

    el.addEventListener('mouseleave', () => {
      if (previewImg) previewImg.style.opacity = '0';
    });
  });
}
