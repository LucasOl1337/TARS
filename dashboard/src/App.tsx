import Layout, { type PageId } from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import MissionsPage from '@/pages/MissionsPage';
import EndpointsPage from '@/pages/EndpointsPage';
import PersonaPage from '@/pages/PersonaPage';
import ToolsPage from '@/pages/ToolsPage';
import VoicePage from '@/pages/VoicePage';
import { usePersistentState } from '@/hooks/usePersistentState';

function App() {
  const [activePage, setActivePage] = usePersistentState<PageId>('activePage', 'dimension');

  const renderPage = () => {
    switch (activePage) {
      case 'dimension': return <Dashboard />;
      case 'missions':  return <MissionsPage />;
      case 'endpoints': return <EndpointsPage />;
      case 'tools':     return <ToolsPage />;
      case 'persona':   return <PersonaPage />;
      case 'voice':     return <VoicePage />;
      default:          return <Dashboard />;
    }
  };

  return (
    <Layout activePage={activePage} onPageChange={setActivePage}>
      {renderPage()}
    </Layout>
  );
}

export default App;
