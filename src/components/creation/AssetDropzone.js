import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function AssetDropzone({ label, roles, onUpload }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const fileInputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragging(true);
    } else if (e.type === 'dragleave') {
      setIsDragging(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFiles(Array.from(e.target.files));
    }
  };

  const handleFiles = async (files) => {
    setIsUploading(true);
    // Simulate presigned direct upload API calls
    // /api/uploads/presign & /api/uploads/complete
    for (const file of files) {
      await new Promise((resolve) => setTimeout(resolve, 800)); // Simulate network
      const newFile = {
        id: Math.random().toString(36).substring(7),
        name: file.name,
        role: roles[0]?.value || 'primary',
      };
      setUploadedFiles((prev) => [...prev, newFile]);
      if (onUpload) onUpload(newFile);
    }
    setIsUploading(false);
  };

  const updateFileRole = (id, newRole) => {
    setUploadedFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, role: newRole } : f))
    );
  };

  return (
    <div className="w-full">
      {label && <label className="block text-sm font-medium text-gray-300 mb-2">{label}</label>}
      <div
        className={`relative border-2 border-dashed rounded-2xl p-8 transition-colors ${
          isDragging ? 'border-blue-500 bg-blue-500/10' : 'border-white/20 hover:border-white/40 bg-white/5'
        } backdrop-blur-sm flex flex-col items-center justify-center cursor-pointer overflow-hidden group`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleChange}
          multiple
        />
        
        <div className="flex flex-col items-center justify-center space-y-4 text-center z-10">
          <div className="p-4 bg-white/5 rounded-full group-hover:scale-110 transition-transform">
            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-200">
              Drag & drop files or <span className="text-blue-400">browse</span>
            </p>
            <p className="text-xs text-gray-500 mt-1">Supports image, video, and audio assets</p>
          </div>
        </div>

        {isUploading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-20"
          >
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-3"></div>
              <span className="text-sm text-gray-300 font-medium">Uploading...</span>
            </div>
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {uploadedFiles.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 space-y-3"
          >
            {uploadedFiles.map((file) => (
              <motion.div
                key={file.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl"
              >
                <div className="flex items-center space-x-3 overflow-hidden">
                  <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <span className="text-sm text-gray-300 truncate max-w-[150px]">{file.name}</span>
                </div>
                
                {roles && roles.length > 0 && (
                  <select
                    value={file.role}
                    onChange={(e) => updateFileRole(file.id, e.target.value)}
                    className="ml-4 bg-gray-900 border border-white/10 rounded-lg text-xs text-gray-300 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  >
                    {roles.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                )}
                
                <button
                  onClick={() => setUploadedFiles(uploadedFiles.filter((f) => f.id !== file.id))}
                  className="ml-2 p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
