import testPDF from './assets/Linear Algebra 5th Edition 2019.pdf'
// React PDF Viewer Core
import { Viewer, Worker } from "@react-pdf-viewer/core"
import '@react-pdf-viewer/core/lib/styles/index.css'

// Import individual plugins
import { toolbarPlugin } from '@react-pdf-viewer/toolbar';
import { pageNavigationPlugin } from '@react-pdf-viewer/page-navigation';
import { zoomPlugin } from '@react-pdf-viewer/zoom';
import { searchPlugin } from '@react-pdf-viewer/search';
import { printPlugin } from '@react-pdf-viewer/print';
import { fullScreenPlugin } from '@react-pdf-viewer/full-screen';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import { dropPlugin } from '@react-pdf-viewer/drop';

// Import plugin styles
import '@react-pdf-viewer/toolbar/lib/styles/index.css';
import '@react-pdf-viewer/page-navigation/lib/styles/index.css';
import '@react-pdf-viewer/zoom/lib/styles/index.css';
import '@react-pdf-viewer/search/lib/styles/index.css';
import '@react-pdf-viewer/print/lib/styles/index.css';
import '@react-pdf-viewer/full-screen/lib/styles/index.css';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';
import '@react-pdf-viewer/bookmark/lib/styles/index.css';
import '@react-pdf-viewer/drop/lib/styles/index.css';

export default function PDFViewer() {
  // Create instances of plugins
  const toolbarPluginInstance = toolbarPlugin();
  const pageNavigationPluginInstance = pageNavigationPlugin();
  const zoomPluginInstance = zoomPlugin();
  const searchPluginInstance = searchPlugin();
  const printPluginInstance = printPlugin();
  const fullScreenPluginInstance = fullScreenPlugin();
  const dropPluginInstance = dropPlugin();
  const defaultLayoutPluginInstance = defaultLayoutPlugin({
  sidebarTabs: (defaultTabs) => [
      // Show thumbnails, bookmarks and attachments in the sidebar
      ...defaultTabs,
      ],
  });

  return (
    <>
      <div className="h-[90vh]" style={{ border: '1px solid rgba(0, 0, 0, 0.3)' }}>
        <Worker workerUrl="https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js">
          <Viewer
            theme="dark"
            defaultScale={1.0}
            fileUrl={testPDF}
            plugins={[
              toolbarPluginInstance,
              pageNavigationPluginInstance,
              zoomPluginInstance,
              searchPluginInstance,
              printPluginInstance,
              fullScreenPluginInstance,
              dropPluginInstance,
              defaultLayoutPluginInstance,
            ]}
          />
        </Worker>
      </div>
    </>
  );
}
