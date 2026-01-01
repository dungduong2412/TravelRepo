"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Download, CheckCircle, AlertCircle } from "lucide-react";

export default function CollaboratorQRPage() {
  const [qrData, setQrData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchQRCode() {
      try {
        const response = await api.get("/collaborators/me/qr-code");
        setQrData(response.data);
      } catch (err: any) {
        setError(err.response?.data?.message || "Failed to load QR code");
      } finally {
        setLoading(false);
      }
    }

    fetchQRCode();
  }, []);

  const downloadQRCode = () => {
    if (!qrData?.qr_code) return;

    const link = document.createElement("a");
    link.href = qrData.qr_code;
    link.download = `collaborator-${qrData.code}-qr.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading your QR code...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            QR Code Not Available
          </h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <p className="text-sm text-gray-500">
            Please contact administrator if you believe this is an error.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Your Collaborator QR Code
          </h1>
          <p className="mt-2 text-gray-600">
            Share this QR code with merchants to verify your identity
          </p>
        </div>

        {/* QR Code Card */}
        <div className="bg-white rounded-lg shadow-lg p-8">
          {/* Verified Badge */}
          {qrData?.verified && (
            <div className="flex items-center justify-center mb-6">
              <div className="inline-flex items-center px-4 py-2 rounded-full bg-green-100 text-green-800">
                <CheckCircle className="w-5 h-5 mr-2" />
                <span className="font-semibold">Verified Collaborator</span>
              </div>
            </div>
          )}

          {/* QR Code Image */}
          <div className="flex justify-center mb-6">
            <div className="bg-white p-4 rounded-xl shadow-inner border-4 border-gray-100">
              <img
                src={qrData?.qr_code}
                alt="Collaborator QR Code"
                className="w-64 h-64 object-contain"
              />
            </div>
          </div>

          {/* Collaborator Info */}
          <div className="space-y-3 mb-6">
            <div className="flex justify-between items-center py-3 border-b">
              <span className="text-gray-600 font-medium">Collaborator Code:</span>
              <span className="font-mono font-bold text-lg">{qrData?.code}</span>
            </div>
            <div className="flex justify-between items-center py-3 border-b">
              <span className="text-gray-600 font-medium">Name:</span>
              <span className="font-semibold">{qrData?.name}</span>
            </div>
          </div>

          {/* Download Button */}
          <button
            onClick={downloadQRCode}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#FF385C] hover:bg-[#e11d48] text-white font-semibold rounded-lg shadow-md transition-colors"
          >
            <Download className="w-5 h-5" />
            Download QR Code
          </button>

          {/* Instructions */}
          <div className="mt-6 p-4 bg-blue-50 rounded-lg">
            <h3 className="font-semibold text-blue-900 mb-2">How to use:</h3>
            <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
              <li>Show this QR code to merchants when checking in</li>
              <li>Merchants will scan it to verify your identity</li>
              <li>Keep this QR code secure and don&apos;t share it publicly</li>
              <li>Download a copy for offline access</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
