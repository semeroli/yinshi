import { getMe } from './api.js';

const me = await getMe();
if (me) {
  const guestLink = document.querySelector('[data-guest]');
  if (guestLink) {
    guestLink.textContent = '我的诗笺';
    guestLink.href = '/app.html';
  }
  const brandLink = document.querySelector('.topnav a[href="/app.html"]');
  if (brandLink) brandLink.textContent = '继续题诗';
}

// 示例卡片：鼠标横向拖拽
const track = document.querySelector('.works-track');
if (track) {
  let down = false;
  let startX = 0;
  let startLeft = 0;
  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    down = true;
    startX = e.clientX;
    startLeft = track.scrollLeft;
    track.style.cursor = 'grabbing';
  });
  track.addEventListener('pointermove', (e) => {
    if (!down) return;
    track.scrollLeft = startLeft - (e.clientX - startX);
  });
  track.addEventListener('pointerup', () => {
    down = false;
    track.style.cursor = '';
  });
  track.addEventListener('pointerleave', () => {
    down = false;
    track.style.cursor = '';
  });
}
