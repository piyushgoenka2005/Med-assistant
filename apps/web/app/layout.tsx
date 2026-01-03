import './globals.css';

export const metadata = {
  title: 'Medi Platform - Prescription Automation',
  description: 'Upload prescriptions, auto-extract medications, compare prices, and place orders'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex flex-col">
          <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <h1 className="text-xl font-bold text-gray-900">Medi Platform</h1>
                    <p className="text-xs text-gray-500">Prescription Automation</p>
                  </div>
                </div>
                <nav className="flex space-x-4">
                  <a href="/" className="text-sm font-medium text-gray-700 hover:text-primary-600 transition-colors">Home</a>
                  <a href="/upload" className="text-sm font-medium text-gray-700 hover:text-primary-600 transition-colors">Upload</a>
                </nav>
              </div>
            </div>
          </header>
          
          <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </main>
          
          <footer className="bg-white border-t border-gray-200 mt-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <p className="text-center text-sm text-gray-500">
                © 2026 Medi Platform. Automated prescription processing with AI extraction.
              </p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
