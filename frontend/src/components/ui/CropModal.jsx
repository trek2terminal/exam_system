import { useCallback, useRef, useState } from "react";
import ReactCrop, { centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Button } from "./Button";
import { Modal } from "./Modal";

function centeredAspectCrop(mediaWidth, mediaHeight, aspectRatio) {
  return centerCrop(
    makeAspectCrop(
      {
        unit: "%",
        width: 82
      },
      aspectRatio,
      mediaWidth,
      mediaHeight
    ),
    mediaWidth,
    mediaHeight
  );
}

async function cropImageToBlob(image, crop) {
  const canvas = document.createElement("canvas");
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  const pixelRatio = window.devicePixelRatio || 1;
  const isPercent = crop.unit === "%";
  const cropX = isPercent ? (crop.x / 100) * image.width : crop.x;
  const cropY = isPercent ? (crop.y / 100) * image.height : crop.y;
  const cropWidth = isPercent ? (crop.width / 100) * image.width : crop.width;
  const cropHeight = isPercent ? (crop.height / 100) * image.height : crop.height;

  canvas.width = Math.floor(cropWidth * scaleX * pixelRatio);
  canvas.height = Math.floor(cropHeight * scaleY * pixelRatio);

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare image crop.");

  context.scale(pixelRatio, pixelRatio);
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    cropX * scaleX,
    cropY * scaleY,
    cropWidth * scaleX,
    cropHeight * scaleY,
    0,
    0,
    cropWidth * scaleX,
    cropHeight * scaleY
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("Could not create cropped image."));
    }, "image/png", 0.95);
  });
}

export function CropModal({ imageSrc, aspectRatio = 1, onConfirm, onCancel }) {
  const imageRef = useRef(null);
  const [crop, setCrop] = useState();
  const [completedCrop, setCompletedCrop] = useState(null);
  const [applying, setApplying] = useState(false);

  const onImageLoad = useCallback(event => {
    const { width, height } = event.currentTarget;
    const initialCrop = centeredAspectCrop(width, height, aspectRatio);
    setCrop(initialCrop);
    setCompletedCrop(initialCrop);
  }, [aspectRatio]);

  const applyCrop = async () => {
    if (!imageRef.current || !completedCrop?.width || !completedCrop?.height) return;
    setApplying(true);
    try {
      const blob = await cropImageToBlob(imageRef.current, completedCrop);
      await onConfirm?.(blob);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      open={Boolean(imageSrc)}
      onClose={onCancel}
      title="Crop image"
      className="max-w-2xl"
      footer={(
        <>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={applying}>Cancel</Button>
          <Button type="button" variant="primary" onClick={applyCrop} loading={applying} loadingLabel="Cropping...">
            Apply Crop
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm font-semibold text-text-secondary">Drag to reposition, resize to crop</p>
        <div className="grid max-h-[56vh] place-items-center overflow-auto rounded-lg border border-border bg-background-base p-3">
          <ReactCrop
            crop={crop}
            onChange={nextCrop => setCrop(nextCrop)}
            onComplete={nextCrop => setCompletedCrop(nextCrop)}
            aspect={aspectRatio}
            circularCrop
            keepSelection
          >
            <img
              ref={imageRef}
              src={imageSrc}
              alt="Crop preview"
              className="max-h-[48vh] max-w-full object-contain"
              onLoad={onImageLoad}
            />
          </ReactCrop>
        </div>
      </div>
    </Modal>
  );
}
