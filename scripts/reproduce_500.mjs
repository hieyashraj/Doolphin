// Using built-in global fetch
async function reproduce() {
  const apiKey = "placeholder_ugc_key"; // from .env
  const endpoint = "https://api.muapi.ai/api/v1/grok-imagine-image-to-video";

  console.log("[DIAGNOSTIC] Testing direct request to provider endpoint with current env configuration...");
  console.log(`Endpoint: ${endpoint}`);
  console.log(`x-api-key: ${apiKey.slice(0, 5)}... (sanitized)`);

  const payload = {
    prompt: "Authentic iPhone UGC of Andrew presenting Doolphin",
    images_list: ["/avatars/Andrew E1.png"],
    image_url: "/avatars/Andrew E1.png",
    aspect_ratio: "9:16",
    duration: 6,
    resolution: "720p"
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify(payload)
    });

    console.log(`Provider HTTP Status: ${response.status} ${response.statusText}`);
    const text = await response.text();
    console.log("Provider Raw Response Body:", text);
  } catch (err) {
    console.error("Fetch Exception:", err.message, err.stack);
  }
}

reproduce();
