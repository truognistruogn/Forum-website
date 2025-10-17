// Chờ DOM load
document.addEventListener('DOMContentLoaded', function() {
  let currentToken = localStorage.getItem('token');
  let currentUser = JSON.parse(localStorage.getItem('user') || '{}');

  if (!currentToken || currentUser.role !== 'admin') {
    Swal.fire('Lỗi', 'Chỉ admin truy cập được!', 'error');
    window.location.href = '/';
  }

  document.getElementById('adminUserInfo').innerHTML = `Admin: ${currentUser.username}`;

  function showError(message) {
    Swal.fire({
      icon: 'error',
      title: 'Lỗi!',
      text: message,
      confirmButtonColor: '#d33'
    });
  }

  function showSuccess(message) {
    Swal.fire({
      icon: 'success',
      title: 'Thành công!',
      text: message,
      timer: 1500,
      showConfirmButton: false
    });
  }

  async function loadUsers() {
    try {
      const res = await fetch('/users', { headers: { 'Authorization': `Bearer ${currentToken}` } });
      if (!res.ok) throw new Error('Failed to load users');
      const users = await res.json();
      document.getElementById('usersTable').innerHTML = users.map(user => `
        <tr>
          <td>${user.id}</td>
          <td>${user.username}</td>
          <td>${user.email}</td>
          <td>${user.role}</td>
          <td><button class="btn btn-danger btn-sm" onclick="deleteUser(${user.id})">Xóa</button></td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('Load users error:', err);
      showError('Không tải được danh sách users.');
    }
  }

  async function loadPostsAdmin() {
    try {
      const res = await fetch('/posts');
      if (!res.ok) throw new Error('Failed to load posts');
      const posts = await res.json();
      document.getElementById('postsTable').innerHTML = posts.map(post => `
        <tr>
          <td>${post.id}</td>
          <td>${post.title}</td>
          <td>${post.username}</td>
          <td>${new Date(post.created_at).toLocaleString()}</td>
          <td><button class="btn btn-danger btn-sm" onclick="deletePost(${post.id})">Xóa</button></td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('Load posts error:', err);
      showError('Không tải được danh sách posts.');
    }
  }

  async function deleteUser(id) {
    const result = await Swal.fire({
      title: 'Xác nhận xóa user?',
      text: 'Hành động này không thể hoàn tác!',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6'
    });
    if (!result.isConfirmed) return;
    
    try {
      const res = await fetch(`/users/${id}`, { 
        method: 'DELETE', 
        headers: { 'Authorization': `Bearer ${currentToken}` } 
      });
      if (res.ok) {
        loadUsers();
        showSuccess('Xóa user thành công!');
      } else {
        let data = await res.json();
        showError(data.error || 'Lỗi xóa user');
      }
    } catch (err) {
      console.error('Network error:', err);
      showError('Lỗi kết nối.');
    }
  }

  async function deletePost(id) {
    const result = await Swal.fire({
      title: 'Xác nhận xóa post?',
      text: 'Hành động này không thể hoàn tác!',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6'
    });
    if (!result.isConfirmed) return;
    
    try {
      const res = await fetch(`/posts/${id}`, { 
        method: 'DELETE', 
        headers: { 'Authorization': `Bearer ${currentToken}` } 
      });
      if (res.ok) {
        loadPostsAdmin();
        showSuccess('Xóa post thành công!');
      } else {
        let data = await res.json();
        showError(data.error || 'Lỗi xóa post');
      }
    } catch (err) {
      console.error('Network error:', err);
      showError('Lỗi kết nối.');
    }
  }

 async function deleteComment(id) {
  const result = await Swal.fire({
    title: 'Xác nhận xóa Comment?',
    text: 'Hành động này không thể hoàn tác!',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d33',
    cancelButtonColor: '#3085d6'
  });
  if (!result.isConfirmed) return;
  
  try {
    const res = await fetch(`/comments/${id}`, { 
      method: 'DELETE', 
      headers: { 'Authorization': `Bearer ${currentToken}` } 
    });
    
    // Chỉ đọc JSON nếu có lỗi
    if (res.ok) {
      showSuccess('Xóa comment thành công!');
      // Tải lại toàn bộ vì không biết comment thuộc bài post nào
      loadPostsAdmin(); 
      loadUsers(); // Hoặc bất kỳ hàm nào tải lại dữ liệu cần thiết
    } else {
      const data = await res.json();
      showError(data.error || 'Lỗi xóa comment');
    }
  } catch (err) {
    console.error('Network error:', err);
    showError('Lỗi kết nối.');
  }
}

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/';
  }

  // Load khi trang mở
  loadUsers();
  loadPostsAdmin();
});