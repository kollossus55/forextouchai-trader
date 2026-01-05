import Admin from './pages/Admin';
import Alerts from './pages/Alerts';
import Analytics from './pages/Analytics';
import AutoTrade from './pages/AutoTrade';
import Home from './pages/Home';
import Overview from './pages/Overview';
import Pairs from './pages/Pairs';
import Portfolio from './pages/Portfolio';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import Social from './pages/Social';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Admin": Admin,
    "Alerts": Alerts,
    "Analytics": Analytics,
    "AutoTrade": AutoTrade,
    "Home": Home,
    "Overview": Overview,
    "Pairs": Pairs,
    "Portfolio": Portfolio,
    "Profile": Profile,
    "Settings": Settings,
    "Social": Social,
}

export const pagesConfig = {
    mainPage: "Pairs",
    Pages: PAGES,
    Layout: __Layout,
};