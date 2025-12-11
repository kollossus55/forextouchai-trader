import Overview from './pages/Overview';
import Pairs from './pages/Pairs';
import AutoTrade from './pages/AutoTrade';
import Portfolio from './pages/Portfolio';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Overview": Overview,
    "Pairs": Pairs,
    "AutoTrade": AutoTrade,
    "Portfolio": Portfolio,
}

export const pagesConfig = {
    mainPage: "Overview",
    Pages: PAGES,
    Layout: __Layout,
};