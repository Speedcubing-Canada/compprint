import { Font } from '@react-pdf/renderer';
import { PDF_FONT_BOLD_EXT, PDF_FONT_EXT } from './layoutConstants';

// Turns off @react-pdf hyphenation, which breaks competitor names mid-word with a dash that
// reads as part of the name in print. Documents control line breaks through their own
// computed font sizes instead. Import for the side effect: `import './fontSetup'`.
//
// Not in layoutConstants.ts: the page-count estimator imports that on the main thread, which
// must stay free of @react-pdf.
Font.registerHyphenationCallback((word) => [word]);

// Loaded only when a name uses them. Node (fixture script) needs a path, not a file:// URL.
const src = (url: URL) => url.protocol === 'file:' ? decodeURIComponent(url.pathname) : url.href;
Font.register({ family: PDF_FONT_EXT, src: src(new URL('./fonts/scorecard-sans-regular.otf', import.meta.url)) });
Font.register({ family: PDF_FONT_BOLD_EXT, src: src(new URL('./fonts/scorecard-sans-bold.otf', import.meta.url)) });
