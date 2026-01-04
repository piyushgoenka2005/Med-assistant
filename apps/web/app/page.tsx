import Link from 'next/link';

export default function Home() {
  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="text-center py-12">
        <h2 className="text-4xl font-bold text-gray-900 mb-4">
          Smart Prescription Processing
        </h2>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-8">
          Upload your prescription, get AI-powered extraction, automatic price comparison across pharmacies, and seamless COD ordering.
        </p>
        <Link
          href="/upload"
          className="inline-flex items-center px-6 py-3 bg-primary-600 text-white text-lg font-semibold rounded-lg hover:bg-primary-700 transition-colors shadow-lg hover:shadow-xl"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          Upload Prescription
        </Link>

        <div className="mt-4">
          <Link href="/vendor" className="text-sm text-gray-600 hover:text-gray-900">
            Vendor Dashboard
          </Link>
        </div>
      </div>

      {/* Features Grid */}
      <div className="grid md:grid-cols-3 gap-6 mt-12">
        <div className="card hover:shadow-md transition-shadow">
          <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">AI Extraction</h3>
          <p className="text-gray-600 text-sm">
            OCR + LLM analysis automatically extracts medications, dosages, and instructions from your prescription.
          </p>
        </div>

        <div className="card hover:shadow-md transition-shadow">
          <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Price Comparison</h3>
          <p className="text-gray-600 text-sm">
            Real-time quotes from 3 pharmacy vendors with Pathway integration to find the best price automatically.
          </p>
        </div>

        <div className="card hover:shadow-md transition-shadow">
          <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Cash on Delivery</h3>
          <p className="text-gray-600 text-sm">
            Confirm your order with COD payment. Google Calendar reminders keep you on track with medication schedules.
          </p>
        </div>
      </div>

      {/* How It Works */}
      <div className="card mt-12">
        <h3 className="text-2xl font-bold text-gray-900 mb-6">How It Works</h3>
        <div className="space-y-4">
          <div className="flex items-start space-x-4">
            <div className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-semibold">1</div>
            <div>
              <h4 className="font-semibold text-gray-900">Upload Prescription</h4>
              <p className="text-gray-600 text-sm">Upload your prescription as PDF, PNG, or JPEG with patient details.</p>
            </div>
          </div>
          <div className="flex items-start space-x-4">
            <div className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-semibold">2</div>
            <div>
              <h4 className="font-semibold text-gray-900">Review Extraction</h4>
              <p className="text-gray-600 text-sm">AI extracts medications and instructions. Review and confirm accuracy.</p>
            </div>
          </div>
          <div className="flex items-start space-x-4">
            <div className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-semibold">3</div>
            <div>
              <h4 className="font-semibold text-gray-900">Auto Cart & Best Price</h4>
              <p className="text-gray-600 text-sm">System compares prices across vendors and selects the best offer automatically.</p>
            </div>
          </div>
          <div className="flex items-start space-x-4">
            <div className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-semibold">4</div>
            <div>
              <h4 className="font-semibold text-gray-900">Place COD Order</h4>
              <p className="text-gray-600 text-sm">Confirm order with Cash on Delivery. Get reminders via Google Calendar.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
