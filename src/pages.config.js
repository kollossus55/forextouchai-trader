import Overview from './pages/Overview';
import Pairs from './pages/Pairs';
import AutoTrade from './pages/AutoTrade';
import Portfolio from './pages/Portfolio';
import Analytics from './pages/Analytics';
import Social from './pages/Social';
import Alerts from './pages/Alerts';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Overview": Overview,
    "Pairs": Pairs,
    "AutoTrade": AutoTrade,
    "Portfolio": Portfolio,
    "Analytics": Analytics,
    "Social": Social,
    "Alerts": Alerts,
}

export const pagesConfig = {
    mainPage: "Overview",
    Pages: PAGES,
    Layout: __Layout,
};