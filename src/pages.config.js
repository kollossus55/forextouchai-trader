import Overview from './pages/Overview';
import Pairs from './pages/Pairs';
import AutoTrade from './pages/AutoTrade';
import Portfolio from './pages/Portfolio';
import Analytics from './pages/Analytics';
import Social from './pages/Social';
import Alerts from './pages/Alerts';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import Admin from './pages/Admin';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Overview": Overview,
    "Pairs": Pairs,
    "AutoTrade": AutoTrade,
    "Portfolio": Portfolio,
    "Analytics": Analytics,
    "Social": Social,
    "Alerts": Alerts,
    "Settings": Settings,
    "Profile": Profile,
    "Admin": Admin,
}

export const pagesConfig = {
    mainPage: "Overview",
    Pages: PAGES,
    Layout: __Layout,
};