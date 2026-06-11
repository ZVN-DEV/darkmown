const button = document.querySelector("[data-wd-double]");

if (button) {
  button.addEventListener("click", () => {
    const items = wd.get("cart:items") || [];
    wd.set("cart:items", [...items, ...items]);
  });
}
