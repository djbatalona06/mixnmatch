// Every screen and its address. The addresses match the old pages, so links in
// sign-in emails and returns from the music apps and Stripe still land in the right place.
import { Route, Routes } from "react-router-dom";
import { AppLayout, PublicLayout } from "./components/chrome";
import Account from "./pages/Account";
import Dashboard from "./pages/Dashboard";
import Export from "./pages/Export";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import { Privacy, Terms } from "./pages/Legal";
import Results from "./pages/Results";
import Syncs from "./pages/Syncs";
import Transfer from "./pages/Transfer";

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<Landing />} />
        <Route path="login" element={<Login />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="terms" element={<Terms />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route element={<AppLayout />}>
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="transfer" element={<Transfer />} />
        <Route path="results" element={<Results />} />
        <Route path="syncs" element={<Syncs />} />
        <Route path="account" element={<Account />} />
        <Route path="export" element={<Export />} />
      </Route>
    </Routes>
  );
}
