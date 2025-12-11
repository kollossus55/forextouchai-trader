import Pairs from './pages/Pairs';
import AutoTrade from './pages/AutoTrade';
import Portfolio from './pages/Portfolio';
import Analytics from './pages/Analytics';
import Social from './pages/Social';
import Alerts from './pages/Alerts';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import Admin from './pages/Admin';
import Home from './pages/Home';
import Overview from './pages/Overview';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Pairs": Pairs,
    "AutoTrade": AutoTrade,
    "Portfolio": Portfolio,
    "Analytics": Analytics,
    "Social": Social,
    "Alerts": Alerts,
    "Settings": Settings,
    "Profile": Profile,
    "Admin": Admin,
    "Home": Home,
    "Overview": Overview,
}

export const pagesConfig = {
    mainPage: "Pairs",
    Pages: PAGES,
    Layout: __Layout,
};