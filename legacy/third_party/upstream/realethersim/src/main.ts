// Entry point. Importing the shell defines <ether-app> (and its child components),
// upgrading the element already present in index.html.
import 'katex/dist/katex.min.css';
import './ui/components/app-shell';
import { applyUrlState } from './app/shareLink';

// If the page was opened via a Share deep link (?s=… / ?sim=…), load that system + settings now,
// before the engine boots — so it starts on the shared view instead of the default system.
applyUrlState();
