git pull

echo "git pull 完成"

kill -9 $(ps -ef|grep src/app.js |grep -v grep |awk '{print $2}')
nohup node src/app.js >log/temp.log 2>&1 &
ps -ef | grep src/app.js
echo "ps -ef | grep src/app.js"
echo "success"


