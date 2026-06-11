const button = document.querySelector("[data-wd-demo]");

if (button) {
  button.addEventListener("click", () => {
    button.classList.toggle("is-on");
    button.textContent = button.classList.contains("is-on")
      ? "Colocated index.js is active"
      : "Script is waiting";
  });
}
