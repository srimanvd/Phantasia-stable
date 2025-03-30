import { useState } from 'react';
import './App.css';
import Chatbot from './Chatbot.jsx';
import Desmos from './Desmos.tsx';
import PDFViewer from './PDFViewer.tsx';
import LatexEditor from './LatexEditor.jsx';
import Screenshot from './Screenshot.tsx';
import Animation from './Animation.jsx';
import Logo from "./Logo.tsx";
import { Toaster } from 'react-hot-toast';

// Icons
import chatBotIcon from './assets/icons/chatbot.svg'
import whiteboardIcon from "./assets/icons/whiteboard.svg"
import desmosIcon from "./assets/icons/desmos.svg"
import animationIcon from "./assets/icons/animation.svg"
import latexIcon from "./assets/icons/latex.svg"


// React Resizable Panels
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

// React Tldraw
import { Tldraw } from 'tldraw';
import 'tldraw/tldraw.css';

function App() {
  const [activeTab, setActiveTab] = useState('chat');

  return (
    <>
      <div className="mx-2" style={{fontFamily: "'Proximanova', system-ui, sans-serif"}}>
        <Logo />
        <div className="flex h-[95.5vh]">
          <div className="h-[90vh] w-20 pt-4 flex justify-center">
            {/* Sidebar content */}
            <div className="flex flex-col items-center gap-2">
              <button onClick={() => setActiveTab("chat")} data-tip="Chat" className={`tooltip btn btn-square btn-outline ${activeTab === 'chat' ? 'btn-primary' : 'btn-neutral'}`}>
                <img src={chatBotIcon} alt="Chatbot" className="w-5 h-5"/>
              </button>
              <button onClick={() => setActiveTab("desmos")} data-tip="Desmos" className={`tooltip btn btn-square btn-outline ${activeTab === 'desmos' ? 'btn-primary' : 'btn-neutral'}`}>
                <img src={desmosIcon} alt="Desmos" className="w-5 h-5"/>
              </button>
              <button onClick={() => setActiveTab("latex")} data-tip="Latex" className={`tooltip btn btn-square btn-outline ${activeTab === 'latex' ? 'btn-primary' : 'btn-neutral'}`}>
                <img src={latexIcon} alt="Latex" className="w-5 h-5"/>
              </button>
              <button onClick={() => setActiveTab("whiteboard")} data-tip="Draw" className={`tooltip btn btn-square btn-outline ${activeTab === 'whiteboard' ? 'btn-primary' : 'btn-neutral'}`}>
                <img src={whiteboardIcon} alt="Whiteboard" className="w-5 h-5"/>
              </button>
              <button onClick={() => setActiveTab("animation")} data-tip="Anim" className={`tooltip btn btn-square btn-outline ${activeTab === 'animation' ? 'btn-primary' : 'btn-neutral'}`}>
                <img src={animationIcon} alt="Animation" className="w-5 h-5"/>
              </button>
              <Screenshot activeTab={activeTab}/>
            </div>
          </div>
          <PanelGroup autoSaveId="persistence" direction="horizontal">
            <Panel defaultSize={50} minSize={36} className="overflow-auto">
              <div className="p-4">
                <PDFViewer />
              </div>
            </Panel>
            <PanelResizeHandle />
            <Panel minSize={25} className="">
              <div className="flex h-[90vh]">
                <div className="flex flex-col justify-end w-full p-4">
                  {/* Instead of conditionally rendering, always render and toggle visibility */}
                  <div style={{ visibility: activeTab === 'chat' ? 'visible' : 'hidden', position: activeTab === 'chat' ? 'static' : 'absolute', width: '100%', height: '100%' }}>
                    <div className="" style={{
                      visibility: activeTab === "chat" ? "visible" : "hidden",
                      position: activeTab === "chat" ? "static" : "absolute",
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center", // Center vertically
                      gap: "40px"
                    }}>
                      <Chatbot />
                    </div>
                  </div>
                  <div style={{ visibility: activeTab === 'desmos' ? 'visible' : 'hidden', position: activeTab === 'desmos' ? 'static' : 'absolute', width: '100%', height: '100%' }}>
                    <Desmos />
                  </div>
                  <div style={{ visibility: activeTab === 'whiteboard' ? 'visible' : 'hidden', position: activeTab === 'whiteboard' ? 'static' : 'absolute', width: '100%', height: '100%' }}>
                    <Tldraw
                      persistenceKey="tldraw"
                      defaultState={{
                        settings: {
                          theme: 'dark',
                          isDarkMode: true
                        }
                      }}
                    />
                  </div>
                  <div
                    style={{
                      visibility:
                        activeTab === "animation" ? "visible" : "hidden",
                      position:
                        activeTab === "animation" ? "static" : "absolute",
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center", // Center vertically
                      gap: "40px", // Add consistent spacing
                    }}
                  >
                    <Animation />
                  </div>
                  <div style={{ display: activeTab === 'latex' ? 'block' : 'none', width: '100%', height: '100%' }}>
                    <LatexEditor />
                  </div>
                </div>
              </div>
            </Panel>
          </PanelGroup>
          <Toaster
            position="bottom-right"
            reverseOrder={false}
          />
        </div>
      </div>
    </>
  );
}

export default App;
