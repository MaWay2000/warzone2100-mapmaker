// Load the main game module via a `<script type="module">` element.
// htmlpreview.github.io serves raw files with a `text/plain` MIME type, which
// breaks ES module loading. When running under htmlpreview we therefore use a
// jsDelivr URL that provides the correct headers; otherwise the script is loaded
// relative to the page for local use.
(() => {
  const gameModulePath = (location.hostname === 'htmlpreview.github.io')
    ? 'https://cdn.jsdelivr.net/gh/MaWay2000/wzmap@main/js/game.js'
    : './js/game.js';
  const script = document.createElement('script');
  script.type = 'module';
  script.src = gameModulePath;
  script.onerror = err => console.error('Failed to load game module:', err);
  document.head.appendChild(script);
})();