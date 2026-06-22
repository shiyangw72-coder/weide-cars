// AutoDealer Main JS

document.addEventListener('DOMContentLoaded', function() {
  // Auto-dismiss alerts
  const alerts = document.querySelectorAll('.alert-dismissible');
  alerts.forEach(function(alert) {
    setTimeout(function() {
      alert.classList.remove('show');
      setTimeout(function() { alert.remove(); }, 300);
    }, 5000);
  });

  // Confirm before delete buttons that don't use the inline confirm
  document.querySelectorAll('[data-confirm]').forEach(function(el) {
    el.addEventListener('click', function(e) {
      if (!confirm(el.dataset.confirm)) {
        e.preventDefault();
      }
    });
  });

  // Mobile: close navbar after clicking a nav link
  var navbarCollapse = document.querySelector('.navbar-collapse');
  if (navbarCollapse) {
    navbarCollapse.querySelectorAll('.nav-link:not(.dropdown-toggle)').forEach(function(link) {
      link.addEventListener('click', function() {
        var bsCollapse = bootstrap.Collapse.getInstance(navbarCollapse);
        if (bsCollapse) bsCollapse.hide();
      });
    });
  }
});
