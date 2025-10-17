// Global vars
let currentToken = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || '{}');
let editPostId = null;  // For edit mode
let likeStates = {};  // Track like/dislike state per post: { postId: { liked: bool, disliked: bool } }
let postCounts = {};  // Track counts per post: { postId: { like: num, dislike: num } }

// Global functions (cho onclick trong HTML)
function showLogin() { 
  const loginModalEl = document.getElementById('loginModal');
  if (loginModalEl) {
    new bootstrap.Modal(loginModalEl).show(); 
  } else {
    console.error('[DEBUG] Login modal not found');
    showError('Modal đăng nhập không khả dụng, thử reload trang.');
  }
}
function showRegister() { 
  const registerModalEl = document.getElementById('registerModal');
  if (registerModalEl) {
    new bootstrap.Modal(registerModalEl).show(); 
  } else {
    console.error('[DEBUG] Register modal not found');
    showError('Modal đăng ký không khả dụng, thử reload trang.');
  }
}
function showPostModal() { 
  const postModalEl = document.getElementById('postModal');
  if (postModalEl) {
    new bootstrap.Modal(postModalEl).show(); 
  } else {
    console.error('[DEBUG] Post modal not found');
    showError('Modal đăng bài không khả dụng, thử reload trang.');
  }
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  location.reload();
}

// Global showError & showSuccess (cho tất cả calls)
function showError(message) {
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      icon: 'error',
      title: 'Lỗi!',
      text: message,
      confirmButtonColor: '#d33'
    });
  } else {
    alert('Lỗi: ' + message);  // Fallback nếu SweetAlert chưa load
  }
}

function showSuccess(message) {
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      icon: 'success',
      title: 'Thành công!',
      text: message,
      timer: 1500,
      showConfirmButton: false
    });
  } else {
    alert('Thành công: ' + message);  // Fallback
  }
}

// onclick functions for posts/comments - SỬA: Toggle like/dislike với update UI và count local
function likePost(postId, type) {
  if (!currentToken) {
    showError('Vui lòng đăng nhập để like.');
    return;
  }

  const state = likeStates[postId] || { liked: false, disliked: false };
  const counts = postCounts[postId] || { like: 0, dislike: 0 };
  const otherType = type === 'like' ? 'dislike' : 'like';

  // Toggle logic
  let wasActive = state[type + 'd'];
  let otherWasActive = state[otherType + 'd'];

  // Apply toggle locally
  state[type + 'd'] = !wasActive;
  if (otherWasActive && state[type + 'd']) {
    // If switching, turn off the other
    state[otherType + 'd'] = false;
    counts[otherType] = Math.max(0, counts[otherType] - 1);
  }
  if (state[type + 'd']) {
    counts[type] += 1;
  } else {
    counts[type] = Math.max(0, counts[type] - 1);
  }

  likeStates[postId] = state;
  postCounts[postId] = counts;

  // Update UI ngay lập tức
  updateLikeUI(postId);

  // Gửi request đến server (server nên handle toggle và trả count mới nếu có)
  fetch('/likes', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json', 
      'Authorization': `Bearer ${currentToken}` 
    },
    body: JSON.stringify({ post_id: postId, type })
  }).then(res => {
    if (res.ok) {
      res.json().then(data => {
        console.log('[DEBUG LIKE] Success response:', data);
        // Sync count từ server nếu có (ưu tiên server)
        if (data.like_count !== undefined) postCounts[postId].like = data.like_count;
        if (data.dislike_count !== undefined) postCounts[postId].dislike = data.dislike_count;
        if (data.liked_by_user !== undefined) state.liked = data.liked_by_user;
        if (data.disliked_by_user !== undefined) state.disliked = data.disliked_by_user;
        likeStates[postId] = state;
        updateLikeUI(postId);  // Update lại nếu server khác
      }).catch(() => {
        console.log('[DEBUG LIKE] Non-JSON success, keeping local');
        // Giữ local nếu non-JSON
      });
    } else {
      // Revert nếu server error
      console.error('[DEBUG LIKE] Server error, reverting...');
      state[type + 'd'] = wasActive;
      if (otherWasActive && !state[type + 'd']) {
        state[otherType + 'd'] = true;
        counts[otherType] += 1;
      }
      if (!state[type + 'd']) {
        counts[type] -= 1;
      } else {
        counts[type] += 1;
      }
      likeStates[postId] = state;
      postCounts[postId] = counts;
      updateLikeUI(postId);
      res.text().then(text => {
        console.error('[DEBUG LIKE] Error details:', text);
        showError('Lỗi like/dislike: ' + (text || 'Unknown'));
      }).catch(() => showError('Lỗi like/dislike'));
    }
  }).catch(err => {
    console.error('Network error like:', err);
    // Revert nếu network error
    state[type + 'd'] = wasActive;
    if (otherWasActive && !state[type + 'd']) {
      state[otherType + 'd'] = true;
      counts[otherType] += 1;
    }
    if (!state[type + 'd']) {
      counts[type] -= 1;
    } else {
      counts[type] += 1;
    }
    likeStates[postId] = state;
    postCounts[postId] = counts;
    updateLikeUI(postId);
    showError('Lỗi kết nối.');
  });
}

// Helper để update UI like/dislike cho một post (với count)
function updateLikeUI(postId) {
  const likeBtn = document.querySelector(`#post-${postId} .like-btn`);
  const dislikeBtn = document.querySelector(`#post-${postId} .dislike-btn`);
  const state = likeStates[postId] || { liked: false, disliked: false };
  const counts = postCounts[postId] || { like: 0, dislike: 0 };

  if (likeBtn) {
    const isLiked = state.liked;
    likeBtn.innerHTML = `<i class="${isLiked ? 'fas' : 'far'} fa-thumbs-up"></i> ${isLiked ? 'Unlike' : 'Like'} (${counts.like})`;
    likeBtn.className = `like-btn btn ${isLiked ? 'btn-success' : 'btn-outline-success'} btn-sm me-2`;
  }
  if (dislikeBtn) {
    const isDisliked = state.disliked;
    dislikeBtn.innerHTML = `<i class="${isDisliked ? 'fas' : 'far'} fa-thumbs-down"></i> ${isDisliked ? 'Undislike' : 'Dislike'} (${counts.dislike})`;
    dislikeBtn.className = `dislike-btn btn ${isDisliked ? 'btn-danger' : 'btn-outline-danger'} btn-sm me-2`;
  }
  console.log(`[DEBUG UI UPDATE] Post ${postId}: liked=${state.liked}, disliked=${state.disliked}, counts=`, counts);
}

function editPost(id, title, content) {
  editPostId = id;
  const postTitle = document.getElementById('postTitle');
  const postContent = document.getElementById('postContent');
  if (postTitle) postTitle.value = title;
  if (postContent) postContent.value = content;
  showPostModal();
  const modalTitle = document.querySelector('#postModal .modal-title');
  if (modalTitle) modalTitle.innerHTML = '<i class="fas fa-edit"></i> Chỉnh Sửa Bài Viết';
}

function addComment(postId) {
  const contentEl = document.getElementById(`comment-${postId}`);
  if (!contentEl) return;
  const content = contentEl.value.trim();
  if (!content || content.length < 3) {
    showError('Comment phải có ít nhất 3 ký tự.');
    return;
  }
  if (!currentToken) {
    showError('Vui lòng đăng nhập để comment.');
    return;
  }
  fetch('/comments', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json', 
      'Authorization': `Bearer ${currentToken}` 
    },
    body: JSON.stringify({ content, post_id: postId })
  }).then(res => {
    if (res.ok) {
      contentEl.value = '';
      loadComments(postId);
      showSuccess('Comment thành công!');
    } else {
      res.text().then(text => {
        console.error('[DEBUG COMMENT] Non-JSON error:', text);
        showError('Lỗi comment');
      }).catch(() => showError('Lỗi comment'));
    }
  }).catch(err => {
    console.error('Network error:', err);
    showError('Lỗi kết nối.');
  });
}


async function deleteComment(id) {
  if (!currentToken) {
    showError('Bạn cần đăng nhập trước!');
    return;
  }

  const result = await Swal.fire({
    title: 'Xác nhận xóa bình luận?',
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
      headers: {
        'Authorization': `Bearer ${currentToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (res.ok) {
      showSuccess('Đã xóa bình luận thành công!');
      // Tải lại danh sách comment sau khi xóa
      document.querySelectorAll('[id^="comments-"]').forEach(div => {
        const postId = div.id.replace('comments-', '');
        loadComments(postId);
      });
    } else {
      // Thử parse JSON error, nếu không được thì dùng text thông thường
      let errorText = 'Lỗi không xác định';
      try {
        const errData = await res.json();
        errorText = errData.error || errorText;
      } catch {
        errorText = await res.text() || errorText;
      }
      showError(`Không thể xóa bình luận: ${errorText}`);
    }
  } catch (err) {
    console.error('[FETCH COMMENT ERROR]', err);
    showError('Lỗi kết nối đến server!');
  }
}




function deletePost(id) {
  Swal.fire({
    title: 'Xác nhận xóa bài viết?',
    text: 'Hành động này không thể hoàn tác!',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d33',
    cancelButtonColor: '#3085d6'
  }).then((result) => {
    if (result.isConfirmed) {
      console.log(`[DEBUG DELETE JS] Calling delete for post ${id}, token: ${!!currentToken}, user:`, currentUser);
      fetch(`/posts/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${currentToken}` }
      }).then(res => {
        if (res.ok) {
          res.json().then(data => {
            console.log('[DEBUG DELETE JS] Response:', data);
            loadPosts();
            showSuccess('Xóa bài viết thành công!');
          }).catch(() => {
            console.log('[DEBUG DELETE JS] Non-JSON success, reloading...');
            loadPosts();
            showSuccess('Xóa bài viết thành công!');
          });
        } else {
          res.text().then(text => {
            console.error('[DEBUG DELETE JS] Non-JSON error:', text);
            showError('Lỗi xóa');
          }).catch(() => showError('Lỗi xóa'));
        }
      }).catch(err => {
        console.error('Network error delete:', err);
        showError('Lỗi kết nối.');
      });
    }
  });
}

// Global loadPosts & loadComments (cho gọi từ onclick) - SỬA: Sync likeStates và postCounts từ server
async function loadPosts() {
  try {
    const res = await fetch('/posts');
    if (!res.ok) throw new Error('Failed to load posts');
    const posts = await res.json();
    console.log('[DEBUG LOAD] Posts loaded:', posts);  // Log để check user_id
    likeStates = {};  // Reset states trước khi sync
    postCounts = {};  // Reset counts
    const postsList = document.getElementById('postsList');
    if (postsList) {
      postsList.innerHTML = posts.map(post => {
        // Sync like state từ server (giả sử server trả liked_by_user và disliked_by_user)
        const liked = post.liked_by_user || false;  // Adjust field name nếu khác
        const disliked = post.disliked_by_user || false;
        likeStates[post.id] = { liked, disliked };
        postCounts[post.id] = { like: post.like_count || 0, dislike: post.dislike_count || 0 };

        console.log(`[DEBUG LOAD] Post ${post.id}: owner_id=${post.user_id}, current_id=${currentUser.id}, role=${currentUser.role}, liked=${liked}, disliked=${disliked}`);  // Log check nút xóa & like
        const isOwner = currentUser.id === post.user_id;
        const isAdmin = currentUser.role === 'admin';
        console.log(`[DEBUG LOAD] Is admin? ${isAdmin}, current role: ${currentUser.role}`);  // Log để check nút xóa comment (sẽ check trong loadComments)
        return `
          <div class="card mb-3 post-item" id="post-${post.id}">
            <div class="card-body">
              <h5 class="card-title">${post.title}</h5>
              <p class="card-text">${post.content}</p>
              <small class="text-muted">Bởi ${post.username} lúc ${new Date(post.created_at).toLocaleString()}</small>
              <div class="mt-2">
                <button class="like-btn btn ${liked ? 'btn-success' : 'btn-outline-success'} btn-sm me-2" onclick="likePost(${post.id}, 'like')">
                  <i class="${liked ? 'fas' : 'far'} fa-thumbs-up"></i> ${liked ? 'Unlike' : 'Like'} (${post.like_count || 0})
                </button>
                <button class="dislike-btn btn ${disliked ? 'btn-danger' : 'btn-outline-danger'} btn-sm me-2" onclick="likePost(${post.id}, 'dislike')">
                  <i class="${disliked ? 'fas' : 'far'} fa-thumbs-down"></i> ${disliked ? 'Undislike' : 'Dislike'} (${post.dislike_count || 0})
                </button>
                ${isOwner ? `<button class="btn btn-warning btn-sm me-2" onclick="editPost(${post.id}, '${post.title.replace(/'/g, "\\'")}', '${post.content.replace(/'/g, "\\'")}')">Sửa</button>` : ''}
                ${(isOwner || isAdmin) ? `<button class="btn btn-danger btn-sm" onclick="deletePost(${post.id})">Xóa</button>` : ''}
              </div>
              <div class="mt-3">
                <input type="text" class="form-control d-inline w-75 mb-2" id="comment-${post.id}" placeholder="Viết comment...">
                <button class="btn btn-primary btn-sm" onclick="addComment(${post.id})">Gửi</button>
              </div>
              <div id="comments-${post.id}" class="mt-2"></div>
            </div>
          </div>
        `;
      }).join('');
    }
    posts.forEach(post => loadComments(post.id));
  } catch (err) {
    console.error('Load posts error:', err);
    const postsList = document.getElementById('postsList');
    if (postsList) postsList.innerHTML = '<div class="alert alert-warning">Không tải được bài viết. Vui lòng thử lại.</div>';
  }
}

async function loadComments(postId) {
  try {
    const res = await fetch(`/comments/${postId}`);
    if (!res.ok) throw new Error('Failed to load comments');
    const comments = await res.json();
    const isAdmin = currentUser.role === 'admin';
    console.log(`[DEBUG LOAD COMMENTS] For post ${postId}, isAdmin: ${isAdmin}, role: ${currentUser.role}`);  // Log để debug nút xóa
    let html = comments.map(comment => {
      return `
        <div class="border-start ps-3 ms-3 small" id="comment-item-${comment.id}">
          <strong>${comment.username}:</strong> ${comment.content}
          <small class="text-muted"> ${new Date(comment.created_at).toLocaleString()}</small>
          ${isAdmin ? `<button class="btn btn-danger btn-sm ms-2" onclick="deleteComment(${comment.id})">Xóa Comment</button>` : ''}
        </div>
      `;
    }).join('');
    const commentsDiv = document.getElementById(`comments-${postId}`);
    if (commentsDiv) commentsDiv.innerHTML = html;
  } catch (err) {
    console.error('Load comments error:', err);
    const commentsDiv = document.getElementById(`comments-${postId}`);
    if (commentsDiv) commentsDiv.innerHTML = '<small class="text-muted">Không tải được comment.</small>';
  }
}

// Chờ DOM load xong trước khi chạy code
document.addEventListener('DOMContentLoaded', function() {
  console.log('[DEBUG] DOM loaded, initializing...');  // Log để check

  // Update UI sau login - SỬA: Check elements tồn tại
  function updateUIAfterLogin() {
    const userInfo = document.getElementById('userInfo');
    const postBtn = document.getElementById('postBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginBtn = document.getElementById('loginBtn');
    const registerBtn = document.getElementById('registerBtn');
    const adminBtn = document.getElementById('adminBtn');

    if (userInfo) {
      userInfo.innerHTML = `Chào ${currentUser.username} (${currentUser.role})`;
      userInfo.style.display = 'block';
    }
    if (postBtn) postBtn.style.display = 'block';
    if (logoutBtn) logoutBtn.style.display = 'inline-block';
    if (loginBtn) loginBtn.style.display = 'none';
    if (registerBtn) registerBtn.style.display = 'none';
    if (adminBtn && currentUser.role === 'admin') adminBtn.style.display = 'inline-block';
    console.log('[DEBUG] UI updated - Current user:', currentUser);  // Log debug role/id
  }

  // Validation functions - SỬA: Thư giãn login password min=1 (không bắt buộc dài)
  function validateLogin(username, password) {
    if (!username || username.trim().length < 3) {
      showError('Tên đăng nhập phải có ít nhất 3 ký tự.');
      return false;
    }
    if (!password || password.length < 1) {  // Giảm từ 6 xuống 1 để dễ test
      showError('Mật khẩu không được rỗng.');
      return false;
    }
    return true;
  }

  function validateRegister(username, email, password) {
    if (!username || username.trim().length < 3) {
      showError('Tên đăng nhập phải có ít nhất 3 ký tự.');
      return false;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('Email không hợp lệ (phải có @ và domain).');
      return false;
    }
    if (!password || password.length < 8 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      showError('Mật khẩu phải có ít nhất 8 ký tự, bao gồm chữ hoa, thường và số.');
      return false;
    }
    return true;
  }

  function validatePost(title, content) {
    if (!title || title.trim().length < 5 || title.length > 200) {
      showError('Tiêu đề phải có 5-200 ký tự.');
      return false;
    }
    if (!content || content.trim().length < 10) {
      showError('Nội dung phải có ít nhất 10 ký tự.');
      return false;
    }
    return true;
  }

  // Login - SỬA: Fix res.json() an toàn (tránh network error nếu server lỗi)
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const usernameEl = document.getElementById('loginUsername');
      const passwordEl = document.getElementById('loginPassword');
      if (!usernameEl || !passwordEl) {
        showError('Form đăng nhập không khả dụng.');
        return;
      }
      const username = usernameEl.value.trim();
      const password = passwordEl.value;
      
      if (!validateLogin(username, password)) return;

      try {
        console.log('[DEBUG LOGIN] Sending login request for', username);  // Log debug
        const res = await fetch('/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        let data;
        try {
          data = await res.json();
        } catch (jsonErr) {
          console.error('[DEBUG LOGIN] JSON parse error:', jsonErr);
          throw new Error('Server response invalid');
        }
        console.log('[DEBUG LOGIN] Response:', res.status, data);  // Log response
        if (res.ok) {
          localStorage.setItem('token', data.token);
          localStorage.setItem('user', JSON.stringify(data.user));
          currentToken = data.token;
          currentUser = data.user;
          updateUIAfterLogin();
          const loginModalEl = document.getElementById('loginModal');
          if (loginModalEl) {
            const btnClose = loginModalEl.querySelector('.btn-close');
            if (btnClose) btnClose.click();
          }
          loadPosts();
          showSuccess('Đăng nhập thành công!');
        } else {
          showError(data.error || 'Lỗi đăng nhập');
        }
      } catch (err) {
        console.error('[DEBUG LOGIN] Network error:', err);
        showError('Lỗi kết nối mạng. Vui lòng thử lại.');
      }
    });
  } else {
    console.error('[DEBUG] Login form not found');
  }

  // Register
  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const usernameEl = document.getElementById('regUsername');
      const emailEl = document.getElementById('regEmail');
      const passwordEl = document.getElementById('regPassword');
      if (!usernameEl || !emailEl || !passwordEl) {
        showError('Form đăng ký không khả dụng.');
        return;
      }
      const username = usernameEl.value.trim();
      const email = emailEl.value.trim();
      const password = passwordEl.value;
      
      if (!validateRegister(username, email, password)) return;

      try {
        const res = await fetch('/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, email, password })
        });
        let data = await res.json();
        if (res.ok) {
          showSuccess('Đăng ký thành công! Đang chuyển đến đăng nhập.');
          const registerModalEl = document.getElementById('registerModal');
          if (registerModalEl) {
            const btnClose = registerModalEl.querySelector('.btn-close');
            if (btnClose) btnClose.click();
          }
          showLogin();
        } else {
          showError(data.error || 'Lỗi đăng ký');
        }
      } catch (err) {
        console.error('Network error:', err);
        showError('Lỗi kết nối mạng.');
      }
    });
  } else {
    console.error('[DEBUG] Register form not found');
  }

  // Đăng bài / Chỉnh sửa
  const postForm = document.getElementById('postForm');
  if (postForm) {
    postForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const titleEl = document.getElementById('postTitle');
      const contentEl = document.getElementById('postContent');
      if (!titleEl || !contentEl) {
        showError('Form đăng bài không khả dụng.');
        return;
      }
      const title = titleEl.value.trim();
      const content = contentEl.value.trim();
      
      if (!validatePost(title, content)) return;

      try {
        let res;
        if (editPostId) {
          // Mode edit: PUT
          res = await fetch(`/posts/${editPostId}`, {
            method: 'PUT',
            headers: { 
              'Content-Type': 'application/json', 
              'Authorization': `Bearer ${currentToken}` 
            },
            body: JSON.stringify({ title, content })
          });
          editPostId = null;
          const modalTitle = document.querySelector('#postModal .modal-title');
          if (modalTitle) modalTitle.innerHTML = '<i class="fas fa-edit"></i> Đăng Bài Viết';
        } else {
          // Mode tạo mới: POST
          res = await fetch('/posts', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json', 
              'Authorization': `Bearer ${currentToken}` 
            },
            body: JSON.stringify({ title, content })
          });
        }
        
        let data = await res.json();
        if (res.ok) {
          const postModalEl = document.getElementById('postModal');
          if (postModalEl) {
            const btnClose = postModalEl.querySelector('.btn-close');
            if (btnClose) btnClose.click();
          }
          titleEl.value = '';
          contentEl.value = '';
          loadPosts();
          const msg = editPostId ? 'Chỉnh sửa thành công!' : 'Đăng bài thành công!';
          showSuccess(msg);
        } else {
          showError(data.error || 'Lỗi xử lý bài viết');
        }
      } catch (err) {
        console.error('Network error:', err);
        showError('Lỗi kết nối mạng.');
      }
    });
  } else {
    console.error('[DEBUG] Post form not found');
  }

  // Load ban đầu
  loadPosts();
});