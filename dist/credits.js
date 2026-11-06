"use strict";
fetch(new URL("data/cars.json", document.baseURI)).then((response) => { if (!response.ok) throw new Error(); return response.json(); }).then((cars) => {
  const grid = document.querySelector("#credits-grid");
  grid.replaceChildren(...cars.map((car) => {
    const article = document.createElement("article"); article.className = "credit-card";
    const image = document.createElement("img"); image.src = new URL(car.image, document.baseURI).href; image.alt = car.displayName; image.loading = "lazy"; image.width = 900; image.height = 600;
    const body = document.createElement("div");
    const title = document.createElement("h2"); title.textContent = car.displayName;
    const credit = document.createElement("p"); credit.textContent = `Photo: ${car.imageCredit}. ${car.license}. Resized and cropped in gameplay.`;
    const source = document.createElement("a"); source.href = car.sourceUrl; source.textContent = "Original image ↗"; source.target = "_blank"; source.rel = "noopener noreferrer";
    const license = document.createElement("a"); license.href = car.licenseUrl; license.textContent = "License ↗"; license.target = "_blank"; license.rel = "noopener noreferrer"; license.style.marginLeft = "16px";
    body.append(title, credit, source, license); article.append(image, body); return article;
  }));
}).catch(() => { document.querySelector("#credits-grid").textContent = "Photo credits couldn’t load. Please refresh when connected."; });
