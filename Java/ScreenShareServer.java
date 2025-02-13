import javax.imageio.ImageIO;
import javax.swing.*;
import java.awt.*;
import java.io.BufferedInputStream;
import java.net.ServerSocket;
import java.net.Socket;

public class ScreenShareServer {
    final int w = 1280, h = 720;
    final int x = Toolkit.getDefaultToolkit().getScreenSize().width / 2 - w / 2, y = Toolkit.getDefaultToolkit().getScreenSize().height / 2 - h / 2;
    JFrame frame;

    public static void main(String[] args) {
        new ScreenShareServer();
    }

    public ScreenShareServer() {
        frame = new JFrame("server");
        frame.setBounds(x, y, w, h);
        frame.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        frame.setVisible(true);

        ServerSocket socket_s = null;
        Socket socket = null;

        try {
            socket_s = new ServerSocket(12345);
            socket = socket_s.accept();
            System.out.println("클라이언트 연결 완료! - 서버" + socket);

            BufferedInputStream bin = new BufferedInputStream(socket.getInputStream());

            while(true) {
                frame.getGraphics().drawImage(ImageIO.read(ImageIO.createImageInputStream(bin)), 0, 0, w, h, frame);
            }

        } catch (Exception e) {
            e.printStackTrace();
        }

    }

}